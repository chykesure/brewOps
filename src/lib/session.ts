// Server-only session helpers — HMAC-signed cookie bound to a server-tracked
// Session row (revocable, expiring, auditable) and optionally to a trusted Device.
import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import type { UserDTO } from "@/lib/types";
import type { User, Session } from "@prisma/client";

const COOKIE = "brewops_session";
const SECRET = process.env.SESSION_SECRET || "brewops-pilot-secret-key-2026";

// Rolling idle window: every verified request extends the session by IDLE_TTL,
// but never beyond ABSOLUTE_TTL from creation (force periodic re-login).
const IDLE_TTL_MS = 14 * 24 * 3600_000; // 14 days idle
const ABSOLUTE_TTL_MS = 90 * 24 * 3600_000; // 90 days absolute
const COOKIE_MAX_AGE_S = 90 * 24 * 3600; // cookie lives as long as the absolute cap

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function makeToken(userId: string, sessionId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, sid: sessionId, iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string): { uid: string; sid: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.uid || !data.sid) return null;
    return { uid: data.uid as string, sid: data.sid as string };
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string, sessionId: string) {
  const jar = await cookies();
  jar.set(COOKIE, makeToken(userId, sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // pilot runs behind gateway proxy
    maxAge: COOKIE_MAX_AGE_S,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
}

/** Creates the DB session row + sets the cookie. Called by the login route. */
export async function openSession(opts: {
  userId: string;
  deviceId?: string | null;
  ip?: string | null;
  ua?: string | null;
}): Promise<string> {
  const session = await db.session.create({
    data: {
      userId: opts.userId,
      deviceId: opts.deviceId ?? null,
      ip: opts.ip ?? null,
      ua: opts.ua?.slice(0, 200) ?? null,
      expiresAt: new Date(Date.now() + IDLE_TTL_MS),
    },
  });
  await setSessionCookie(opts.userId, session.id);
  return session.id;
}

/**
 * Validates the cookie against the Session table:
 * signature, session exists, not revoked, not expired, user active,
 * and (if bound) the device is still approved. Rolling idle extension.
 */
export async function getSessionUser(): Promise<UserDTO | null> {
  const ctx = await getSessionContext();
  return ctx?.user ?? null;
}

export interface SessionContext {
  user: UserDTO;
  session: Session;
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const parsed = verifyToken(token);
  if (!parsed) return null;

  const session = await db.session.findUnique({ where: { id: parsed.sid } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  if (session.userId !== parsed.uid) return null;

  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) return null;

  // A session bound to a device dies the moment that device is revoked
  if (session.deviceId) {
    const device = await db.device.findUnique({ where: { id: session.deviceId } });
    if (!device || !device.approved) return null;
  }

  // Rolling idle extension (throttled to once per minute to avoid write storms)
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    const idleEnd = Date.now() + IDLE_TTL_MS;
    const absoluteEnd = session.createdAt.getTime() + ABSOLUTE_TTL_MS;
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Math.min(idleEnd, absoluteEnd)) },
    }).catch(() => null);
  }

  return { user: toUserDTO(user), session };
}

export async function revokeSession(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }).catch(() => null);
}

export async function revokeAllSessionsFor(userId: string, exceptSessionId?: string) {
  const sessions = await db.session.findMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    select: { id: true },
  });
  for (const s of sessions) {
    await db.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } }).catch(() => null);
  }
  return sessions.length;
}

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as UserDTO["role"],
    trade: u.trade,
    shift: u.shift,
    avatarUrl: u.avatarUrl ?? null,
    departmentId: u.departmentId ?? null,
    hasPassword: Boolean(u.passwordHash),
    pwdChangedAt: u.pwdChangedAt?.toISOString() ?? null,
    licenseKey: u.licenseKey ?? null,
    licenseActive: u.licenseActive,
  };
}

export function hashPin(pin: string): string {
  return hashSecret(pin);
}

export function verifyPin(pin: string, stored: string): boolean {
  return verifySecret(pin, stored);
}

export function hashPassword(password: string): string {
  return hashSecret(password);
}

export function verifyPassword(password: string, stored: string): boolean {
  return verifySecret(password, stored);
}

// ---- scrypt core shared by PIN and password hashing ----

function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifySecret(secret: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(secret, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

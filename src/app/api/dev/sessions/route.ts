import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET /api/dev/sessions — every live login session + the trusted-device
// registry, so the owner can see exactly who is connected from where.
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const now = new Date();
  const [sessions, devices] = await Promise.all([
    db.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now } },
      include: { user: { select: { name: true, email: true, role: true } }, device: { select: { name: true, platform: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
    }),
    db.device.findMany({
      include: { user: { select: { name: true, email: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
    }),
  ]);

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id, userName: s.user.name, userEmail: s.user.email, role: s.user.role,
      deviceName: s.device?.name ?? null, platform: s.device?.platform ?? null,
      ip: s.ip, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
    devices: devices.map((d) => ({
      id: d.id, userName: d.user.name, userEmail: d.user.email, name: d.name,
      platform: d.platform, mobile: d.mobile, approved: d.approved,
      lastSeenAt: d.lastSeenAt.toISOString(), createdAt: d.createdAt.toISOString(),
    })),
  });
}

// PATCH /api/dev/sessions — remote revocation:
//   { sessionId }            → revoke one session
//   { userId, all: true }    → sign a user out everywhere
//   { deviceId }             → un-trust a device + kill its sessions
//   { all: true }            → sign EVERYONE out (plant-wide lockout)
export async function PATCH(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let body: { sessionId?: string; userId?: string; deviceId?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Plant-wide lockout
  if (body.all) {
    const res = await db.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    await logDevEvent("SESSIONS_PURGED", `Signed out ALL users · ${res.count} session(s)`);
    return NextResponse.json({ ok: true, revoked: res.count });
  }

  // One session
  if (body.sessionId) {
    const s = await db.session.findUnique({ where: { id: body.sessionId }, include: { user: { select: { email: true } } } });
    if (!s) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    await db.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    await logDevEvent("SESSION_REVOKED", `${s.user.email} · session ${s.id.slice(-6)}`);
    return NextResponse.json({ ok: true });
  }

  // All sessions of one user
  if (body.userId) {
    const u = await db.user.findUnique({ where: { id: body.userId }, select: { email: true } });
    if (!u) return NextResponse.json({ error: "User not found." }, { status: 404 });
    const res = await db.session.updateMany({ where: { userId: body.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await logDevEvent("SESSIONS_PURGED", `${u.email} · ${res.count} session(s)`);
    return NextResponse.json({ ok: true, revoked: res.count });
  }

  // Un-trust a device (and kill the sessions riding on it)
  if (body.deviceId) {
    const d = await db.device.findUnique({ where: { id: body.deviceId }, include: { user: { select: { email: true } } } });
    if (!d) return NextResponse.json({ error: "Device not found." }, { status: 404 });
    const res = await db.session.updateMany({ where: { deviceId: d.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.device.update({ where: { id: d.id }, data: { approved: false } });
    await logDevEvent("DEVICE_REVOKED", `${d.user.email} · ${d.name}${res.count ? ` · ${res.count} session(s) killed` : ""}`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
}

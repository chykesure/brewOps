// Server-only dev-console gate — the owner's private backdoor into the
// developer console. Two independent locks:
//   1. The keyboard shortcut (Shift+Alt+B) only opens the PIN dialog — client side.
//   2. The 4-digit developer PIN, verified SERVER side, mints a short-lived
//      HMAC-signed cookie that is the ONLY key to /api/dev/* routes.
// The PIN never ships to the client, and the cookie is independent of the
// user session, so backup/restore/reset still work after sessions are wiped.
import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE = "brewops_dev";
const SECRET = process.env.SESSION_SECRET || "brewops-pilot-secret-key-2026";
const DEV_PIN = process.env.DEV_PIN || "1004"; // owner's private developer PIN
const TTL_MS = 2 * 3600_000; // dev cookie lives 2 hours, then the PIN is asked again

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** Constant-time PIN check. Never logs, never returns the pin. */
export function devPinOk(pin: string): boolean {
  const a = Buffer.from(String(pin ?? ""));
  const b = Buffer.from(DEV_PIN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setDevCookie(): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TTL_MS })).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // pilot runs behind the gateway proxy
    maxAge: Math.floor(TTL_MS / 1000),
    path: "/",
  });
}

export async function isDevUnlocked(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export async function clearDevCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
}
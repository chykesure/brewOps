import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openSession, toUserDTO, verifyPin, verifyPassword } from "@/lib/session";
import {
  clientIp, clearLoginFails, csrfEvidence, csrfVerdict, loginRateOk, logSecurityEvent, recordLoginFail,
} from "@/lib/security";

export const dynamic = "force-dynamic";

function badDevice(d: unknown): boolean {
  if (!d || typeof d !== "object") return true;
  const id = (d as { id?: unknown }).id;
  return typeof id !== "string" || id.length < 8 || id.length > 64;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent") ?? "";

  const csrf = csrfVerdict(req);
  if (!csrf.allow) {
    await logSecurityEvent({ kind: "CSRF_BLOCKED", detail: csrfEvidence(req), ip, ua });
    return NextResponse.json({ error: "Request blocked: cross-origin sign-in is not allowed." }, { status: 403 });
  }
  if (csrf.flagged) {
    // Proxied access where the internal Host cannot match the public Origin.
    // Allowed (SameSite=Lax cookie is the backstop) but kept on the record.
    await logSecurityEvent({ kind: "CSRF_FLAGGED", detail: csrfEvidence(req), ip, ua });
  }

  try {
    const { email, pin, password, device } = await req.json();
    if (!email || !pin) return NextResponse.json({ error: "Email and PIN are required." }, { status: 400 });

    const mail = String(email).trim().toLowerCase();
    const rateKey = `${ip}:${mail}`;

    // ---- Brute-force throttle: 5 failures per 15 min, then a 15 min cool-off ----
    const rate = loginRateOk(rateKey);
    if (!rate.ok) {
      await logSecurityEvent({ email: mail, kind: "LOGIN_LOCKED", detail: `Throttled, retry in ${rate.retryAfterMin} min`, ip, ua });
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${rate.retryAfterMin} minute${rate.retryAfterMin === 1 ? "" : "s"}.` },
        { status: 429 },
      );
    }

    const user = await db.user.findUnique({ where: { email: mail } });
    if (!user || !user.active || !verifyPin(String(pin), user.pinHash)) {
      const lockIn = recordLoginFail(rateKey);
      await logSecurityEvent({ userId: user?.id ?? null, email: mail, kind: "LOGIN_FAIL", detail: user && user.active ? "Wrong PIN" : "Unknown or inactive account", ip, ua });
      return NextResponse.json(
        lockIn > 0
          ? { error: `Too many failed attempts. Locked for ${lockIn} minute${lockIn === 1 ? "" : "s"}.` }
          : { error: "Invalid email or PIN." },
        { status: 401 },
      );
    }

    // ---- Device synchronization (multi-device trust) ----
    // A device the user has never approved must prove ownership with the work
    // password before it can sign in. The very first device a user ever uses is
    // trusted automatically so a fresh account is never locked out.
    let deviceId: string | null = null;
    let needsPassword = false;
    if (device && !badDevice(device)) {
      const fingerprint = String(device.id);
      const platform = typeof device.platform === "string" ? device.platform.slice(0, 40) : null;
      const name = typeof device.name === "string" && device.name.trim()
        ? device.name.trim().slice(0, 80)
        : (platform ?? "Unknown device");
      const mobile = device.mobile === undefined ? true : Boolean(device.mobile);

      let dev = await db.device.findUnique({ where: { userId_fingerprint: { userId: user.id, fingerprint } } });
      const alreadyApproved = dev?.approved ?? false;
      if (!dev) {
        dev = await db.device.create({
          data: { userId: user.id, fingerprint, name, platform, mobile, approved: false },
        });
      }

      if (!alreadyApproved) {
        const approvedCount = await db.device.count({ where: { userId: user.id, approved: true } });
        const strongCredential = typeof password === "string" && password.length > 0 && user.passwordHash
          ? verifyPassword(password, user.passwordHash)
          : false;

        if (strongCredential) {
          await db.device.update({
            where: { id: dev.id },
            data: { approved: true, approvedAt: new Date(), name, platform, mobile },
          });
          await logSecurityEvent({ userId: user.id, email: mail, kind: "DEVICE_SYNCED", detail: `Device synchronized via password: ${name}`, ip, ua });
        } else if (approvedCount === 0) {
          // First device this account has ever used — bootstrap trust
          await db.device.update({
            where: { id: dev.id },
            data: { approved: true, approvedAt: new Date(), name, platform, mobile },
          });
          await logSecurityEvent({ userId: user.id, email: mail, kind: "DEVICE_AUTO_APPROVED", detail: `First device trusted automatically: ${name}`, ip, ua });
        } else {
          needsPassword = true;
        }
      } else {
        await db.device.update({
          where: { id: dev.id },
          data: { lastSeenAt: new Date(), name, platform, mobile },
        });
      }

      if (!needsPassword) deviceId = dev.id;
    }

    if (needsPassword) {
      await logSecurityEvent({ userId: user.id, email: mail, kind: "LOGIN_FAIL", detail: "Unsynchronized device: work password required", ip, ua });
      return NextResponse.json(
        {
          error: "This device is not synchronized yet. Enter  password to synchronize it.",
          needsPassword: true,
        },
        { status: 403 },
      );
    }

    await openSession({ userId: user.id, deviceId, ip, ua });
    clearLoginFails(rateKey);
    await logSecurityEvent({ userId: user.id, email: mail, kind: "LOGIN_OK", detail: deviceId ? "Signed in on a synchronized device" : "Signed in (no device binding)", ip, ua });

    return NextResponse.json({ user: toUserDTO(user) });
  } catch {
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}

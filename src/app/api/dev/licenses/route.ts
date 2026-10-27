import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { newLicenseKey } from "@/lib/license";
import { hashPassword } from "@/lib/session";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// Unambiguous alphabet — sync passwords are read aloud over the phone and
// typed on workshop phones, so lookalike characters are excluded (no I/L/O/0/1).
const PW_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newSyncPassword(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += PW_ALPHABET[randomInt(PW_ALPHABET.length)];
  return out;
}

// GET /api/dev/licenses — every account with its license key, activation state
// and device-synchronization password status.
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const rows = await db.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, trade: true, shift: true, active: true,
      licenseKey: true, licenseActive: true, passwordHash: true, pwdChangedAt: true, createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  // The hash itself never leaves the server — only a boolean summary.
  const users = rows.map(({ passwordHash, ...u }) => ({ ...u, hasPassword: Boolean(passwordHash) }));
  return NextResponse.json({ users });
}

// PATCH /api/dev/licenses
//   { userId, licenseActive }                     → activate / deactivate one account
//   { userId, regenerate: true }                  → issue a fresh license key
//   { fillMissing: true }                         → issue keys for every account without one
//   { userId, passwordAction: "regenerate" }      → mint a new 8-char sync password (shown ONCE)
//   { userId, passwordAction: "set", password }   → set a custom sync password (4–64 chars)
export async function PATCH(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let body: { userId?: string; licenseActive?: boolean; regenerate?: boolean; fillMissing?: boolean; passwordAction?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (body.fillMissing) {
    const missing = await db.user.findMany({ where: { licenseKey: null }, select: { id: true } });
    for (const u of missing) {
      await db.user.update({ where: { id: u.id }, data: { licenseKey: newLicenseKey() } });
    }
    await logDevEvent("LICENSE_FILL", `${missing.length} key(s) issued`);
    return NextResponse.json({ ok: true, filled: missing.length });
  }

  // ---- Device sync password management (artisan & engineer alike) ----
  if (body.passwordAction === "regenerate" || body.passwordAction === "set") {
    if (!body.userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });
    const user = await db.user.findUnique({ where: { id: body.userId } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

    if (body.passwordAction === "set") {
      const pw = typeof body.password === "string" ? body.password.trim() : "";
      if (pw.length < 4 || pw.length > 64) {
        return NextResponse.json({ error: "Password must be 4–64 characters." }, { status: 400 });
      }
      await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(pw), pwdChangedAt: new Date() } });
      await logDevEvent("SYNC_PASSWORD_SET", `${user.email} · custom sync password set`);
      return NextResponse.json({ ok: true });
    }

    const pw = newSyncPassword();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(pw), pwdChangedAt: new Date() } });
    await logDevEvent("SYNC_PASSWORD_REGENERATE", `${user.email} · new sync password issued`);
    // The plaintext is returned exactly once — give it to the user verbally.
    return NextResponse.json({ ok: true, password: pw });
  }

  if (!body.userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const user = await db.user.findUnique({ where: { id: body.userId } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  if (body.regenerate) {
    const licenseKey = newLicenseKey();
    await db.user.update({ where: { id: user.id }, data: { licenseKey } });
    await logDevEvent("LICENSE_REGENERATE", `${user.email} · new key ${licenseKey}`);
    return NextResponse.json({ ok: true, licenseKey });
  }

  if (typeof body.licenseActive === "boolean") {
    await db.user.update({ where: { id: user.id }, data: { licenseActive: body.licenseActive } });
    await logDevEvent(body.licenseActive ? "LICENSE_ACTIVATE" : "LICENSE_DEACTIVATE", user.email);
    return NextResponse.json({ ok: true, licenseActive: body.licenseActive });
  }

  return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
}
import { NextRequest, NextResponse } from "next/server";
import { getSessionContext, hashPassword, revokeAllSessionsFor, verifyPassword, verifyPin } from "@/lib/session";
import { clientIp, logSecurityEvent, sameOrigin } from "@/lib/security";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/auth/password — change the work password (Security module)
// The current password (or the account PIN) must be presented. Changing the
// password signs out every other device, so a stolen session cannot linger.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const current = String(body?.currentPassword ?? "");
    const next = String(body?.newPassword ?? "");

    if (!current) return NextResponse.json({ error: "Enter your current password (or your PIN)." }, { status: 400 });

    const user = await db.user.findUnique({ where: { id: ctx.user.id } });
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const currentOk =
      (user.passwordHash ? verifyPassword(current, user.passwordHash) : false) ||
      verifyPin(current, user.pinHash);
    if (!currentOk) {
      await logSecurityEvent({ userId: user.id, email: user.email, kind: "PASSWORD_CHANGED", detail: "Rejected: wrong current credential", ip: clientIp(req), ua: req.headers.get("user-agent") ?? "" });
      return NextResponse.json({ error: "Current password is not correct." }, { status: 400 });
    }

    if (next.length < 8) return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) {
      return NextResponse.json({ error: "New password must mix letters and numbers (e.g. Brew2026)." }, { status: 400 });
    }
    if (next === current) return NextResponse.json({ error: "The new password must be different." }, { status: 400 });

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(next), pwdChangedAt: new Date() },
    });

    const others = await revokeAllSessionsFor(user.id, ctx.session.id);
    await logSecurityEvent({
      userId: user.id, email: user.email, kind: "PASSWORD_CHANGED",
      detail: `Password changed · ${others} other session(s) signed out`,
      ip: clientIp(req), ua: req.headers.get("user-agent") ?? "",
    });

    return NextResponse.json({ ok: true, othersSignedOut: others });
  } catch {
    return NextResponse.json({ error: "Could not change the password." }, { status: 500 });
  }
}

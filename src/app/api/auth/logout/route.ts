import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionContext, revokeSession } from "@/lib/session";
import { clientIp, logSecurityEvent, sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (sameOrigin(req)) {
    const ctx = await getSessionContext();
    if (ctx) {
      await revokeSession(ctx.session.id);
      await logSecurityEvent({
        userId: ctx.user.id, email: ctx.user.email, kind: "LOGOUT",
        detail: "Signed out", ip: clientIp(req), ua: req.headers.get("user-agent") ?? "",
      });
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

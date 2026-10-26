import { NextRequest, NextResponse } from "next/server";
import { devPinOk, setDevCookie } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { clientIp, loginRateOk, recordLoginFail, clearLoginFails, sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// POST /api/dev/unlock — the owner's private gate. Verifies the 4-digit
// developer PIN server-side (brute-force throttled) and mints the dev cookie.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  const ip = clientIp(req);
  const rate = loginRateOk(`dev:${ip}`);
  if (!rate.ok) {
    return NextResponse.json({ error: `Too many attempts. Try again in ${rate.retryAfterMin} min.` }, { status: 429 });
  }

  let pin = "";
  try {
    const body = await req.json();
    pin = String(body?.pin ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!devPinOk(pin)) {
    const lockMin = recordLoginFail(`dev:${ip}`);
    await logDevEvent("UNLOCK_FAIL", `ip ${ip}${lockMin > 0 ? " · now locked" : ""}`);
    return NextResponse.json(
      { error: lockMin > 0 ? `Too many attempts. Locked for ${lockMin} min.` : "Incorrect PIN." },
      { status: 401 },
    );
  }

  clearLoginFails(`dev:${ip}`);
  await setDevCookie();
  await logDevEvent("UNLOCK_OK", `ip ${ip}`);
  return NextResponse.json({ ok: true });
}

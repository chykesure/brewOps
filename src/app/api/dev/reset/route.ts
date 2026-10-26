import { NextRequest, NextResponse } from "next/server";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { factoryReset, purgeActivity } from "@/lib/dev-data";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// POST /api/dev/reset — clear activity data or run the full factory reset.
// Body: { mode: "activity" | "factory", confirm: "CLEAR" | "RESET" }
export async function POST(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let mode = "";
  let confirm = "";
  try {
    const body = await req.json();
    mode = String(body?.mode ?? "");
    confirm = String(body?.confirm ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (mode === "activity") {
    if (confirm !== "CLEAR") return NextResponse.json({ error: 'Type CLEAR in the confirmation box first.' }, { status: 400 });
    const deleted = await purgeActivity();
    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    await logDevEvent("RESET_ACTIVITY", `${total} records wiped`);
    return NextResponse.json({ ok: true, deleted });
  }

  if (mode === "factory") {
    if (confirm !== "RESET") return NextResponse.json({ error: 'Type RESET in the confirmation box first.' }, { status: 400 });
    const deleted = await factoryReset();
    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    await logDevEvent("RESET_FACTORY", `${total} records wiped · engineers + org kept`);
    return NextResponse.json({ ok: true, deleted });
  }

  return NextResponse.json({ error: "Unknown reset mode." }, { status: 400 });
}

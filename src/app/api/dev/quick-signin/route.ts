import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

const KEY = "quickSignIn";

// GET /api/dev/quick-signin — is the pilot "Quick sign-in" chip visible on the
// login screen? Default is visible ("on") until the owner hides it.
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  const row = await db.settings.findUnique({ where: { key: KEY } });
  return NextResponse.json({ on: row?.value !== "off" });
}

// PUT /api/dev/quick-signin — show or hide the pilot quick sign-in block on the
// login screen. Hidden = the login door looks like production (email + PIN only).
export async function PUT(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let on: boolean | undefined;
  try {
    const body = await req.json();
    on = body?.on;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof on !== "boolean") return NextResponse.json({ error: "Body must be { on: boolean }." }, { status: 400 });

  await db.settings.upsert({
    where: { key: KEY },
    update: { value: on ? "on" : "off" },
    create: { key: KEY, value: on ? "on" : "off" },
  });
  await logDevEvent(on ? "QUICKSIGNIN_SHOW" : "QUICKSIGNIN_HIDE", on ? "Pilot chip visible on login" : "Login shows email + PIN only");
  return NextResponse.json({ ok: true, on });
}

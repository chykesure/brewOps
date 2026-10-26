import { NextResponse } from "next/server";
import { isDevUnlocked, clearDevCookie } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";

export const dynamic = "force-dynamic";

// GET /api/dev/session — is the dev console unlocked on this browser?
export async function GET() {
  return NextResponse.json({ unlocked: await isDevUnlocked() });
}

// DELETE /api/dev/session — lock the console (clears the dev cookie).
export async function DELETE() {
  await clearDevCookie();
  await logDevEvent("LOCK");
  return NextResponse.json({ ok: true });
}

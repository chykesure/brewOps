import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/login-opts — public, cosmetic login-screen options. The login view
// reads this before render so the owner's console switch ("hide the pilot
// quick sign-in chip") takes effect for everyone on the door itself.
// Exposes nothing sensitive — only a UI flag.
export async function GET() {
  try {
    const row = await db.settings.findUnique({ where: { key: "quickSignIn" } });
    return NextResponse.json({ quickSignIn: row?.value !== "off" });
  } catch {
    // If the DB is briefly unavailable, fail open to the default (visible).
    return NextResponse.json({ quickSignIn: true });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET /api/dev/maintenance — current maintenance-mode state
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  const row = await db.settings.findUnique({ where: { key: "maintenanceMode" } });
  return NextResponse.json({ on: row?.value === "on" });
}

// PUT /api/dev/maintenance — flip maintenance mode. When ON, every artisan is
// locked out behind a "scheduled maintenance" screen; engineers keep access so
// the owner can keep working (and reach this console to flip it back).
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
    where: { key: "maintenanceMode" },
    update: { value: on ? "on" : "off" },
    create: { key: "maintenanceMode", value: on ? "on" : "off" },
  });
  await logDevEvent(on ? "MAINTENANCE_ON" : "MAINTENANCE_OFF", on ? "Artisans locked out" : "Artisans back in");
  return NextResponse.json({ ok: true, on });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isPmCycle } from "@/lib/types";
import { randomTagCode, tagCodeFor } from "@/lib/geo";

// PATCH /api/machines/[id] — update ownership / PM schedule / GPS position / tag code (admin)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.ownerId !== undefined) data.ownerId = body.ownerId ? String(body.ownerId) : null;
    if (body.pmCycle !== undefined && isPmCycle(String(body.pmCycle))) data.pmCycle = String(body.pmCycle);
    if (body.pmDay !== undefined) data.pmDay = Math.min(31, Math.max(1, Number(body.pmDay) || 1));
    if (body.location !== undefined) data.location = body.location ? String(body.location).slice(0, 80) : null;
    // ---- Geofence setup: the Engineer stands at the machine and captures the position ----
    if (body.lat !== undefined) data.lat = body.lat === null ? null : Number(body.lat);
    if (body.lng !== undefined) data.lng = body.lng === null ? null : Number(body.lng);
    if (body.geoRadiusM !== undefined) data.geoRadiusM = Math.min(2000, Math.max(30, Number(body.geoRadiusM) || 150));
    // ---- Tag code: rotate to regenerate the QR (old stickers stop working) ----
    if (body.rotateCode === true) data.checkinCode = randomTagCode();
    else if (body.checkinCode !== undefined) {
      const code = String(body.checkinCode).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      if (code.length < 4) return NextResponse.json({ error: "Nameplate code must be at least 4 characters." }, { status: 400 });
      data.checkinCode = code;
    } else if (body.ensureCode === true) {
      const m = await db.machine.findUnique({ where: { id } });
      if (m && !m.checkinCode) data.checkinCode = tagCodeFor(m.id + m.code);
    }
    await db.machine.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Update failed." }, { status: 500 });
  }
}

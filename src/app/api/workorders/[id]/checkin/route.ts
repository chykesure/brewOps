import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { haversineM, normalizeCode } from "@/lib/geo";

function fmtM(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

// POST /api/workorders/[id]/checkin — prove physical presence at the machine.
// Zero-printing flow: (1) GPS fix inside the machine's geofence (primary — nothing to
// scan or paste), (2) the machine's registered nameplate number typed from its metal
// plate (fallback when GPS can't get a fix indoors), (3) an optional QR sticker scan
// for sites that do print tags. Every attempt — including rejected ones — is written
// to the WoCheckIn audit trail.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = await req.json();
    const method = String(body?.method ?? "").toUpperCase();
    if (!["QR", "CODE", "GPS"].includes(method)) {
      return NextResponse.json({ error: "Check-in method must be QR, CODE or GPS." }, { status: 400 });
    }

    const wo = await db.workOrder.findUnique({ where: { id }, include: { machine: true } });
    if (!wo) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
    if (["COMPLETED", "CANCELLED"].includes(wo.status)) {
      return NextResponse.json({ error: "This work order is closed." }, { status: 400 });
    }
    if (user.role !== "ADMIN" && wo.assignedToId !== user.id) {
      return NextResponse.json({ error: "Not your work order." }, { status: 403 });
    }

    const machine = wo.machine;
    const rawCode = body.code != null ? String(body.code) : null;
    const lat = typeof body.lat === "number" && isFinite(body.lat) ? body.lat : null;
    const lng = typeof body.lng === "number" && isFinite(body.lng) ? body.lng : null;
    const acc = typeof body.acc === "number" && isFinite(body.acc) && body.acc >= 0 ? body.acc : null;
    const photo = typeof body.photo === "string" && body.photo.startsWith("/") ? body.photo.slice(0, 500) : null;

    // ---- Validate the evidence presented ----
    const wantsCode = method === "QR" || method === "CODE";
    if (wantsCode && !machine.checkinCode) {
      return NextResponse.json({ error: "No nameplate number is registered for this machine yet. Ask the Engineer to register it from the machine's metal nameplate." }, { status: 400 });
    }
    if (method === "GPS" && (machine.lat == null || machine.lng == null)) {
      return NextResponse.json({ error: "This machine has no GPS anchor yet. Type its nameplate number instead, or ask the Engineer to capture the position at the machine." }, { status: 400 });
    }

    const codeOk = wantsCode && rawCode != null && normalizeCode(rawCode) === normalizeCode(machine.checkinCode!);
    const distanceM =
      lat != null && lng != null && machine.lat != null && machine.lng != null
        ? haversineM(lat, lng, machine.lat, machine.lng)
        : null;
    const radius = machine.geoRadiusM ?? 150;
    // Indoor fixes drift — forgive the reported GPS accuracy (capped at 100 m) before flagging.
    const margin = Math.min(acc ?? 0, 100);
    const outOfRange = distanceM != null && distanceM > radius + margin;

    const reasons: string[] = [];
    if (wantsCode && !codeOk) reasons.push("That number doesn't match this machine's registered nameplate. Check the metal plate on the machine and re-type it");
    if (outOfRange) reasons.push(`GPS shows you ${fmtM(distanceM!)} from the machine (limit ${radius} m${margin > 0 ? " + GPS error margin" : ""})`);
    if (!wantsCode && distanceM == null) reasons.push("No usable GPS fix. Enable location and retry, or type the machine's nameplate number");

    let result: "VERIFIED" | "FLAGGED" | "REJECTED";
    if (wantsCode ? !codeOk : distanceM == null) {
      // Hard fail: the evidence itself is invalid
      result = "REJECTED";
    } else if (reasons.length > 0) {
      // Valid code but contradicted by GPS — flag for the Engineer
      result = "FLAGGED";
    } else {
      result = "VERIFIED";
    }

    // ---- Audit trail: every attempt is recorded, rejected ones included ----
    await db.woCheckIn.create({
      data: {
        workOrderId: wo.id,
        machineId: machine.id,
        userId: user.id,
        method,
        code: rawCode != null ? normalizeCode(rawCode).slice(0, 12) : null,
        lat, lng, distanceM,
        photo,
        result,
        reasons: reasons.join("\n") || null,
      },
    });

    if (result === "REJECTED") {
      return NextResponse.json({ error: reasons[0], result, reasons }, { status: 403 });
    }

    await db.workOrder.update({
      where: { id: wo.id },
      data: {
        verification: result,
        checkInMethod: method,
        checkInAt: new Date(),
        checkInLat: lat,
        checkInLng: lng,
        checkInDistanceM: distanceM,
        checkInPhoto: photo,
        flagReasons: result === "FLAGGED" ? reasons.join("\n") : null,
      },
    });

    return NextResponse.json({ ok: true, result, distanceM, reasons });
  } catch {
    return NextResponse.json({ error: "Check-in failed." }, { status: 500 });
  }
}

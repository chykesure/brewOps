import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isStatus } from "@/lib/types";
import { haversineM } from "@/lib/geo";

// POST /api/status — log a component status (the daily round check-in)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const { componentId, status, note, photo } = body ?? {};
    if (!componentId || !isStatus(String(status))) {
      return NextResponse.json({ error: "componentId and a valid status are required." }, { status: 400 });
    }

    const component = await db.component.findUnique({ where: { id: componentId }, include: { machine: true } });
    if (!component) return NextResponse.json({ error: "Component not found." }, { status: 404 });

    // Who may log status on a machine: the whole crew. Every artisan sees every
    // machine, valve, instrument and component and can set their state — the
    // Engineer may direct anyone anywhere, and the log still stamps WHO reported
    // plus the GPS distance, so attribution and evidence stay intact.

    // On-site GPS evidence — stamped server-side, distance from the machine tag computed here
    const lat = typeof body.lat === "number" && isFinite(body.lat) ? body.lat : null;
    const lng = typeof body.lng === "number" && isFinite(body.lng) ? body.lng : null;
    const distanceM =
      lat != null && lng != null && component.machine.lat != null && component.machine.lng != null
        ? haversineM(lat, lng, component.machine.lat, component.machine.lng)
        : null;

    const [log] = await db.$transaction([
      db.statusLog.create({
        data: {
          componentId: component.id, status: String(status),
          note: note ? String(note).slice(0, 500) : null, photo: photo ? String(photo) : null,
          lat, lng, distanceM,
          userId: user.id,
        },
        include: { user: true, component: { include: { machine: true } } },
      }),
      db.component.update({ where: { id: component.id }, data: { currentStatus: String(status) } }),
    ]);

    // Auto downtime handling: BROKEN opens a downtime record, WORKING closes the open one
    if (status === "BROKEN") {
      const open = await db.downtime.findFirst({ where: { machineId: component.machineId, endedAt: null } });
      if (!open) {
        await db.downtime.create({
          data: {
            machineId: component.machineId,
            reason: note ? String(note).slice(0, 300) : `${component.name} reported BROKEN`,
            reportedById: user.id,
          },
        });
      }
    }
    if (status === "WORKING") {
      await db.downtime.updateMany({ where: { machineId: component.machineId, endedAt: null }, data: { endedAt: new Date() } });
    }

    return NextResponse.json({
      ok: true,
      log: { id: log.id, status: log.status, note: log.note, photo: log.photo, userId: log.userId, userName: log.user.name, createdAt: log.createdAt.toISOString() },
    });
  } catch {
    return NextResponse.json({ error: "Could not save status." }, { status: 500 });
  }
}

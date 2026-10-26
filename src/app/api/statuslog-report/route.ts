import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { readOrg } from "@/lib/org";
import { zonedDayBounds } from "@/lib/time";

export const dynamic = "force-dynamic";

// GET /api/statuslog-report?machineId=&from=&to=
// Printable status log report for one machine: every component status entry in the
// window, with who logged it, notes, GPS distance and the org identity for the header.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const machineId = req.nextUrl.searchParams.get("machineId") ?? "";
  const fromStr = req.nextUrl.searchParams.get("from");
  const toStr = req.nextUrl.searchParams.get("to");
  const tz = req.nextUrl.searchParams.get("tz");

  // Window bounds drawn on the reporting device's wall clock
  const toB = toStr ? zonedDayBounds(toStr, tz).end : new Date();
  const from = fromStr ? zonedDayBounds(fromStr, tz).start : new Date(toB.getTime() - 7 * 86400_000);
  const to = toStr ? toB : new Date();
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  }

  const machine = await db.machine.findUnique({
    where: { id: machineId },
    include: {
      department: true,
      owner: { select: { name: true, trade: true } },
      components: { orderBy: { name: "asc" } },
    },
  });
  if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });

  // Every machine is on every artisan's round now, so the printable status log is
  // open to the whole crew — attribution and GPS evidence still stamp each entry.

  const logs = await db.statusLog.findMany({
    where: { component: { machineId: machine.id }, createdAt: { gte: from, lte: to } },
    include: { user: { select: { name: true, trade: true } }, component: { select: { name: true, partCode: true, category: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const byStatus: Record<string, number> = {};
  for (const l of logs) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;

  const reporters = Array.from(new Set(logs.map((l) => l.user.name)));

  const org = await readOrg();

  return NextResponse.json({
    machine: {
      id: machine.id, code: machine.code, name: machine.name,
      departmentName: machine.department.name,
      location: machine.location, functionalLoc: machine.functionalLoc, equipmentNo: machine.equipmentNo,
      ownerName: machine.owner?.name ?? null, ownerTrade: machine.owner?.trade ?? null,
      componentCount: machine.components.length,
    },
    from: from.toISOString(), to: to.toISOString(),
    summary: { total: logs.length, byStatus, reporters },
    logs: logs.map((l) => ({
      id: l.id, componentName: l.component.name, partCode: l.component.partCode,
      category: l.component.category, status: l.status, note: l.note,
      distanceM: l.distanceM, userName: l.user.name, trade: l.user.trade,
      createdAt: l.createdAt.toISOString(),
    })),
    org,
  });
}

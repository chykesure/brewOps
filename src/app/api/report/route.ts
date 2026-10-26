import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { zonedDayBounds } from "@/lib/time";
import type { DayReport, Status } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/report?date=YYYY-MM-DD&tz=Africa/Lagos — the daily status report (admin)
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const dateParam = req.nextUrl.searchParams.get("date");
  const tz = req.nextUrl.searchParams.get("tz");
  const { start, end, dateStr } = zonedDayBounds(dateParam, tz);
  if (!dateParam || isNaN(start.getTime())) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

  const machines = await db.machine.findMany({
    where: { active: true },
    include: { department: true, components: { orderBy: { name: "asc" }, include: { statusLogs: { where: { createdAt: { gte: start, lte: end } }, orderBy: { createdAt: "desc" }, include: { user: true } } } } },
    orderBy: { code: "asc" },
  });

  const summary: Record<string, number> = {};
  const report: DayReport = { date: dateStr, summary, machines: [], workOrders: [], downtimes: [], spares: [], totalLogs: 0, totalComponents: 0 };

  for (const m of machines) {
    const logs = m.components.flatMap((c) =>
      c.statusLogs.map((l) => ({
        id: l.id, status: l.status as Status, note: l.note, photo: l.photo, distanceM: l.distanceM,
        userId: l.userId, userName: l.user.name, createdAt: l.createdAt.toISOString(),
        componentName: c.name, componentPartCode: c.partCode, componentCategory: c.category,
      }))
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const l of logs) summary[l.status] = (summary[l.status] ?? 0) + 1;
    const componentsWithLogs = new Set(m.components.filter((c) => c.statusLogs.length > 0).map((c) => c.id));
    const missing = m.components.filter((c) => !componentsWithLogs.has(c.id)).map((c) => ({ name: c.name, partCode: c.partCode }));
    if (m.components.length > 0) {
      report.machines.push({
        machineId: m.id, code: m.code, name: m.name, departmentName: m.department.name,
        logs: logs.map(({ componentName, componentPartCode, componentCategory, ...rest }) => ({ ...rest, componentName, componentPartCode, componentCategory })),
        missing,
      });
      report.totalComponents += m.components.length;
      report.totalLogs += logs.length;
    }
  }

  const wos = await db.workOrder.findMany({
    where: { OR: [{ createdAt: { gte: start, lte: end } }, { completedAt: { gte: start, lte: end } }] },
    include: { machine: true, assignedTo: true },
    orderBy: { code: "asc" },
  });
  report.workOrders = wos.map((w) => ({
    code: w.code, title: w.title, machine: w.machine.code, status: w.status, type: w.type,
    priority: w.priority, assignedTo: w.assignedTo?.name ?? null,
    dueDate: w.dueDate.toISOString(), completedAt: w.completedAt?.toISOString() ?? null,
    verification: w.verification ?? undefined,
  }));

  // downtime episodes overlapping the day
  const dts = await db.downtime.findMany({
    where: { startedAt: { lte: end }, OR: [{ endedAt: null }, { endedAt: { gte: start } }] },
    include: { machine: true, reportedBy: true },
    orderBy: { startedAt: "desc" },
  });
  report.downtimes = dts.map((d) => {
    const s = Math.max(d.startedAt.getTime(), start.getTime());
    const e = d.endedAt ? Math.min(d.endedAt.getTime(), end.getTime()) : end.getTime();
    const minutes = Math.max(1, Math.round((e - s) / 60000));
    return {
      machineCode: d.machine.code, machineName: d.machine.name, reason: d.reason,
      startedAt: d.startedAt.toISOString(), endedAt: d.endedAt?.toISOString() ?? null,
      minutes, open: d.endedAt === null, reportedBy: d.reportedBy.name,
    };
  });

  const parts = await db.part.findMany({ orderBy: { code: "asc" } });
  report.spares = parts.map((p) => ({ code: p.code, name: p.name, stock: p.stock, reorderLevel: p.reorderLevel }));

  return NextResponse.json(report);
}

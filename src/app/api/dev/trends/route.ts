import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// GET /api/dev/trends?days=14 — per-day activity series for the console's
// Trends tab: status logs, work orders created/completed, downtime events.
export async function GET(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? 14) || 14));
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const [logs, wos, downs, checkIns, escalations] = await Promise.all([
    db.statusLog.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    db.workOrder.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, completedAt: true } }),
    db.downtime.findMany({ where: { startedAt: { gte: since } }, select: { startedAt: true } }),
    db.woCheckIn.count({ where: { createdAt: { gte: since } } }),
    db.escalation.count({ where: { createdAt: { gte: since } } }),
  ]);

  // Build a continuous day axis (no gaps in the chart)
  const axis: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    axis.push(dayKey(d));
  }
  const buckets = new Map<string, { logs: number; wosCreated: number; wosCompleted: number; downtimes: number }>();
  for (const k of axis) buckets.set(k, { logs: 0, wosCreated: 0, wosCompleted: 0, downtimes: 0 });
  for (const l of logs) {
    const b = buckets.get(dayKey(l.createdAt));
    if (b) b.logs++;
  }
  for (const w of wos) {
    const c = buckets.get(dayKey(w.createdAt));
    if (c) c.wosCreated++;
    if (w.completedAt) {
      const d = buckets.get(dayKey(w.completedAt));
      if (d) d.wosCompleted++;
    }
  }
  for (const dt of downs) {
    const b = buckets.get(dayKey(dt.startedAt));
    if (b) b.downtimes++;
  }

  const series = axis.map((date) => ({ date, ...(buckets.get(date) as { logs: number; wosCreated: number; wosCompleted: number; downtimes: number }) }));

  return NextResponse.json({
    days,
    series,
    totals: {
      logs: logs.length,
      wosCreated: wos.length,
      wosCompleted: wos.filter((w) => w.completedAt).length,
      downtimes: downs.length,
      checkIns,
      escalations,
    },
  });
}

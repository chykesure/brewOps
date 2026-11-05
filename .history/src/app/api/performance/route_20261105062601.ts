import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/performance?days=90 — Artisan effectiveness board (Engineer only).
// Answers one question for the Engineer: WHO gets tasks done, and how fast?
//
// Per artisan, over the window:
//   completed      work orders finished (status COMPLETED) in the window
//   avgHours       mean time from start (or machine check-in) to completion
//   fastestHours   best single task time
//   onTimePct      finished on or before the due date
//   verifiedPct    finished with VERIFIED machine evidence (anti office-fraud)
//   speedPct       vs the plant average (100 = exactly average, >100 faster)
//   score          0–100 composite: 40% on-time + 30% verified + 30% speed
//   open/overdue   work orders still on their desk (overdue = past due date)

const OPEN = ["PENDING", "ACCEPTED", "IN_PROGRESS"];

export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Engineers only." }, { status: 403 });

  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? 90);
  const days = Math.min(365, Math.max(7, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 90));
  const since = new Date(Date.now() - days * 86400_000);
  const now = Date.now();

  const [artisans, wos] = await Promise.all([
    db.user.findMany({
      where: { role: "ARTISAN" },
      select: { id: true, name: true, trade: true, shift: true, active: true },
      orderBy: { name: "asc" },
    }),
    db.workOrder.findMany({
      where: {
        assignedToId: { not: null },
        OR: [{ completedAt: { gte: since } }, { completedAt: null }],
      },
      select: {
        assignedToId: true, status: true, dueDate: true,
        startedAt: true, completedAt: true, checkInAt: true, verification: true,
      },
    }),
  ]);

  type Done = { hours: number; valid: boolean; onTime: boolean; verified: boolean };
  const per = new Map<string, { done: Done[]; open: number; overdue: number }>();
  const allDurations: number[] = [];
  for (const a of artisans) per.set(a.id, { done: [], open: 0, overdue: 0 });

  for (const w of wos) {
    if (!w.assignedToId) continue;
    const bucket = per.get(w.assignedToId);
    if (!bucket) continue;

    if (w.status === "COMPLETED" && w.completedAt) {
      // Task time = completed − started; the machine check-in is the fallback
      // anchor when a start stamp is missing. Steps of the same job all share
      // one work order, so this measures the task, not individual ticks.
      const start = w.startedAt ?? w.checkInAt ?? null;
      let hours: number | null = null;
      if (start && w.completedAt.getTime() > start.getTime()) {
        hours = (w.completedAt.getTime() - start.getTime()) / 3600_000;
        allDurations.push(hours);
      }
      bucket.done.push({
        hours: hours ?? 0,
        valid: hours !== null,
        onTime: w.completedAt.getTime() <= w.dueDate.getTime(),
        verified: w.verification === "VERIFIED",
      });
    } else if (OPEN.includes(w.status)) {
      bucket.open += 1;
      if (w.dueDate.getTime() < now) bucket.overdue += 1;
    }
  }

  const plantAvg = allDurations.length > 0
    ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
    : null;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : null);

  const rows = artisans
    .map((a) => {
      const b = per.get(a.id)!;
      const timed = b.done.filter((d) => d.valid);
      const avg = timed.length > 0 ? timed.reduce((s, d) => s + d.hours, 0) / timed.length : null;
      const fastest = timed.length > 0 ? Math.min(...timed.map((d) => d.hours)) : null;
      const onTimePct = pct(b.done.filter((d) => d.onTime).length, b.done.length);
      const verifiedPct = pct(b.done.filter((d) => d.verified).length, b.done.length);
      const speedPct = avg !== null && plantAvg !== null && plantAvg > 0 && avg > 0
        ? Math.round((plantAvg / avg) * 100)
        : null;
      // Composite 0–100: reliability first (on-time), then evidence, then speed
      // (capped at 2× the plant average so one tiny job cannot game the board).
      const onTimePart = (onTimePct ?? 0) * 0.4;
      const verifiedPart = (verifiedPct ?? 0) * 0.3;
      const speedPart = speedPct !== null ? (Math.min(speedPct, 200) / 2) * 0.3 : 0;
      const score = b.done.length > 0 ? Math.round(onTimePart + verifiedPart + speedPart) : null;
      return {
        userId: a.id, name: a.name, trade: a.trade, shift: a.shift, active: a.active,
        completed: b.done.length, open: b.open, overdue: b.overdue,
        onTimePct, verifiedPct,
        avgHours: avg !== null ? r1(avg) : null,
        fastestHours: fastest !== null ? r1(fastest) : null,
        speedPct, score,
      };
    })
    .sort((x, y) =>
      (y.score ?? -1) - (x.score ?? -1) ||
      y.completed - x.completed ||
      (x.avgHours ?? Infinity) - (y.avgHours ?? Infinity),
    );

  return NextResponse.json({ days, plantAvgHours: plantAvg !== null ? r1(plantAvg) : null, rows });
}
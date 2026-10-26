import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import {
  ALERTING_STATUSES, CRITICAL_STATUSES,
  type MachineTrend, type Status, type TrendComponent, type TrendDay,
  type TrendDirection, type TrendIncident, type TrendVerdict, type TrendsData,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY_MS = 86400_000;
const HISTORY = 30; // always compute over 30 days so 7d vs prev-7d deltas exist

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Union of downtime intervals clipped to a day → minutes down (no double counting) */
function mergedMinutes(intervals: { s: number; e: number }[], dayStart: number, dayEnd: number): number {
  const clipped = intervals
    .map((iv) => [Math.max(iv.s, dayStart), Math.min(iv.e, dayEnd)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curS = 0, curE = 0;
  let open = false;
  for (const [s, e] of clipped) {
    if (!open) { curS = s; curE = e; open = true; }
    else if (s <= curE) { curE = Math.max(curE, e); }
    else { total += curE - curS; curS = s; curE = e; }
  }
  if (open) total += curE - curS;
  return Math.round(total / 60000);
}

function verdictFor(uptime7: number, faults7: number, faultsPrev7: number, downtimeMin7: number, criticalNow: number): TrendVerdict {
  if (uptime7 < 92 || (faults7 > faultsPrev7 && faults7 >= 3) || (faults7 >= 2 && faults7 > faultsPrev7 && uptime7 < 96)) return "DEGRADING";
  if (criticalNow > 0 && (faults7 >= 2 || downtimeMin7 > 120)) return "DEGRADING";
  if (uptime7 < 97.5 || faults7 >= 2 || downtimeMin7 > 90 || (criticalNow > 0 && faults7 >= 1)) return "WATCH";
  return "FINE";
}

function directionFor(uptime7: number, uptimePrev7: number, faults7: number, faultsPrev7: number): TrendDirection {
  const du = uptime7 - uptimePrev7;
  if (du >= 1 && faults7 <= faultsPrev7) return "IMPROVING";
  if (du <= -1 || faults7 > faultsPrev7 + 2) return "WORSENING";
  return "STABLE";
}

// GET /api/trends?days=14&machineId=... — reliability trends (role-aware)
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const isAdmin = user.role === "ADMIN";

  const days = Math.min(30, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 14));
  const machineIdParam = req.nextUrl.searchParams.get("machineId");
  const now = new Date();

  const machines = await db.machine.findMany({
    where: { active: true, ...(isAdmin ? {} : { ownerId: user.id }) },
    include: { department: true, owner: true, components: { orderBy: { name: "asc" } } },
    orderBy: { code: "asc" },
  });
  const machineIds = machines.map((m) => m.id);

  const winStart = new Date(now.getTime() - HISTORY * DAY_MS);
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const allDays: string[] = [];
  for (let i = HISTORY - 1; i >= 0; i--) allDays.push(dateKey(new Date(day0.getTime() - i * DAY_MS)));
  const dayIndex = new Map(allDays.map((d, i) => [d, i]));

  // ---- pull raw data once ----
  const logs = machineIds.length
    ? await db.statusLog.findMany({
        where: { component: { machineId: { in: machineIds } }, createdAt: { gte: winStart, lt: new Date(day0.getTime() + DAY_MS) } },
        select: { status: true, note: true, createdAt: true, componentId: true, component: { select: { machineId: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const downtimes = machineIds.length
    ? await db.downtime.findMany({
        where: { machineId: { in: machineIds }, startedAt: { lt: new Date(day0.getTime() + DAY_MS) }, OR: [{ endedAt: null }, { endedAt: { gte: winStart } }] },
        select: { id: true, machineId: true, reason: true, startedAt: true, endedAt: true },
      })
    : [];

  // ---- per-machine aggregation buckets ----
  type CompAgg = { logs: number; faults: number; last: { note: string | null; at: Date } | null };
  type MachineAgg = {
    daily: TrendDay[];
    intervals: { s: number; e: number }[];
    statusMix: Map<string, number>;
    compAgg: Map<string, CompAgg>;
    faultCompCount: Map<string, number>;
  };
  const agg = new Map<string, MachineAgg>();
  for (const m of machines) {
    agg.set(m.id, {
      daily: allDays.map((date) => ({ date, uptimePct: 100, downtimeMin: 0, faults: 0, reportedPct: 0 })),
      intervals: [], statusMix: new Map(), compAgg: new Map(), faultCompCount: new Map(),
    });
  }

  for (const l of logs) {
    const a = agg.get(l.component.machineId);
    if (!a) continue;
    const di = dayIndex.get(dateKey(l.createdAt));
    if (di === undefined) continue;
    const isAlert = ALERTING_STATUSES.includes(l.status as Status);
    if (isAlert) a.daily[di].faults += 1;
    a.statusMix.set(l.status, (a.statusMix.get(l.status) ?? 0) + 1);
    let ca = a.compAgg.get(l.componentId);
    if (!ca) { ca = { logs: 0, faults: 0, last: null }; a.compAgg.set(l.componentId, ca); }
    ca.logs += 1;
    if (isAlert) {
      ca.faults += 1;
      a.faultCompCount.set(l.componentId, (a.faultCompCount.get(l.componentId) ?? 0) + 1);
    }
    if (!ca.last || l.createdAt > ca.last.at) ca.last = { note: l.note, at: l.createdAt };
  }

  // reported% per machine-day = distinct components with ≥1 log that day
  const reportedByMachineDay = new Map<string, Map<number, Set<string>>>();
  for (const l of logs) {
    const mid = l.component.machineId;
    const di = dayIndex.get(dateKey(l.createdAt));
    if (di === undefined) continue;
    let byDay = reportedByMachineDay.get(mid);
    if (!byDay) { byDay = new Map(); reportedByMachineDay.set(mid, byDay); }
    let set = byDay.get(di);
    if (!set) { set = new Set(); byDay.set(di, set); }
    set.add(l.componentId);
  }

  for (const d of downtimes) {
    agg.get(d.machineId)?.intervals.push({ s: d.startedAt.getTime(), e: d.endedAt ? d.endedAt.getTime() : now.getTime() });
  }

  for (const m of machines) {
    const a = agg.get(m.id)!;
    const total = m.components.length;
    const byDay = reportedByMachineDay.get(m.id);
    for (let di = 0; di < allDays.length; di++) {
      if (total > 0) a.daily[di].reportedPct = Math.round((((byDay?.get(di)?.size ?? 0)) / total) * 100);
      const ds = new Date(`${allDays[di]}T00:00:00`).getTime();
      const mins = mergedMinutes(a.intervals, ds, ds + DAY_MS);
      a.daily[di].downtimeMin = mins;
      a.daily[di].uptimePct = Math.round((1 - Math.min(mins, 1440) / 1440) * 1000) / 10;
    }
  }

  // ---- per-machine trend rows ----
  const slice = allDays.slice(allDays.length - days);
  const last7 = allDays.slice(-7);
  const prev7 = allDays.slice(-14, -7);
  const byDate = new Map<string, TrendDay>();
  for (const m of machines) {
    // index helper per machine
  }
  void byDate;

  function avgUptime(daysSel: string[], daily: TrendDay[]): number {
    const map = new Map(daysSel.map((d) => [d, true]));
    const vals = daily.filter((x) => map.has(x.date)).map((x) => x.uptimePct);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 100;
  }
  function sumField(daysSel: string[], daily: TrendDay[], f: "faults" | "downtimeMin"): number {
    const map = new Map(daysSel.map((d) => [d, true]));
    return daily.filter((x) => map.has(x.date)).reduce((acc, x) => acc + x[f], 0);
  }

  const machineTrends: MachineTrend[] = machines.map((m) => {
    const a = agg.get(m.id)!;
    const uptime7 = avgUptime(last7, a.daily);
    const uptimePrev7 = avgUptime(prev7, a.daily);
    const faults7 = sumField(last7, a.daily, "faults");
    const faultsPrev7 = sumField(prev7, a.daily, "faults");
    const downtimeMin7 = sumField(last7, a.daily, "downtimeMin");
    const criticalNow = m.components.filter((c) => CRITICAL_STATUSES.includes(c.currentStatus as Status)).length;
    const issueNow = m.components.filter((c) => ALERTING_STATUSES.includes(c.currentStatus as Status)).length;

    let topIssue: string | null = null;
    let best = 0;
    for (const [cid, n] of a.faultCompCount) {
      if (n > best) { best = n; topIssue = m.components.find((c) => c.id === cid)?.name ?? null; }
    }

    return {
      machineId: m.id, code: m.code, name: m.name,
      departmentName: m.department.name, ownerName: m.owner?.name ?? null,
      currentIssueCount: issueNow,
      uptimePct: avgUptime(slice, a.daily),
      uptime7, uptimePrev7, faults7, faultsPrev7, downtimeMin7,
      verdict: verdictFor(uptime7, faults7, faultsPrev7, downtimeMin7, criticalNow),
      direction: directionFor(uptime7, uptimePrev7, faults7, faultsPrev7),
      topIssue: faults7 > 0 ? topIssue : null,
      spark: slice.map((d) => a.daily.find((x) => x.date === d)?.uptimePct ?? 100),
    };
  });

  // ---- fleet daily ----
  const fleetDaily: TrendDay[] = slice.map((date) => {
    let uptimeSum = 0, downtimeSum = 0, faults = 0, repSum = 0, n = 0;
    for (const m of machines) {
      const row = agg.get(m.id)!.daily.find((x) => x.date === date);
      if (!row || m.components.length === 0) continue;
      uptimeSum += row.uptimePct; downtimeSum += row.downtimeMin; faults += row.faults; repSum += row.reportedPct; n += 1;
    }
    return {
      date,
      uptimePct: n ? Math.round((uptimeSum / n) * 10) / 10 : 100,
      downtimeMin: downtimeSum,
      faults,
      reportedPct: n ? Math.round(repSum / n) : 0,
    };
  });

  // ---- fleet KPIs ----
  const totalDowntimeMin = fleetDaily.reduce((a, b) => a + b.downtimeMin, 0);
  const faultEvents = fleetDaily.reduce((a, b) => a + b.faults, 0);
  const episodes = downtimes
    .map((d) => ({ start: d.startedAt.getTime(), minutes: ((d.endedAt ? d.endedAt.getTime() : now.getTime()) - d.startedAt.getTime()) / 60000 }))
    .filter((x) => x.start >= now.getTime() - days * DAY_MS && x.minutes > 0);
  const mttrHours = episodes.length
    ? Math.round((episodes.reduce((a, b) => a + b.minutes, 0) / episodes.length) / 60 * 10) / 10
    : null;
  const machineDays = machines.filter((m) => m.components.length > 0).length * days;
  const mtbfHours = episodes.length && machineDays > 0
    ? Math.round(((machineDays * 24 - totalDowntimeMin / 60) / episodes.length) * 10) / 10
    : null;

  const kpis = {
    uptimePct: fleetDaily.length ? Math.round((fleetDaily.reduce((a, b) => a + b.uptimePct, 0) / fleetDaily.length) * 10) / 10 : 100,
    downtimeHours: Math.round((totalDowntimeMin / 60) * 10) / 10,
    faultEvents,
    mtbfHours, mttrHours,
  };

  // ---- detail for one machine ----
  let detail: TrendsData["detail"] = null;
  if (machineIdParam) {
    const m = machines.find((x) => x.id === machineIdParam);
    const a = m ? agg.get(m.id) : undefined;
    if (m && a) {
      const comps: TrendComponent[] = m.components.map((c) => {
        const ca = a.compAgg.get(c.id);
        const logsN = ca?.logs ?? 0;
        const faultsN = ca?.faults ?? 0;
        return {
          id: c.id, name: c.name, partCode: c.partCode, category: c.category,
          currentStatus: c.currentStatus as Status,
          logs: logsN, faults: faultsN,
          cleanPct: logsN ? Math.round(((logsN - faultsN) / logsN) * 100) : 100,
          lastNote: ca?.last?.note ?? null,
          lastAt: ca?.last?.at?.toISOString() ?? null,
        };
      });
      const incidents: TrendIncident[] = downtimes
        .filter((d) => d.machineId === m.id)
        .sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime())
        .slice(0, 12)
        .map((d) => {
          const end = d.endedAt ?? now;
          return {
            id: d.id, reason: d.reason,
            startedAt: d.startedAt.toISOString(), endedAt: d.endedAt?.toISOString() ?? null,
            minutes: Math.max(1, Math.round((end.getTime() - d.startedAt.getTime()) / 60000)),
            open: d.endedAt === null,
          };
        });
      const mt = machineTrends.find((t) => t.machineId === m.id)!;
      detail = {
        machine: mt,
        daily: slice.map((date) => a.daily.find((x) => x.date === date)!),
        statusMix: [...a.statusMix.entries()]
          .map(([status, count]) => ({ status: status as Status, count }))
          .sort((x, y) => y.count - x.count),
        components: comps,
        incidents,
      };
    }
  }

  const data: TrendsData = { windowDays: days, days: slice, kpis, fleetDaily, machines: machineTrends, detail };
  return NextResponse.json(data);
}

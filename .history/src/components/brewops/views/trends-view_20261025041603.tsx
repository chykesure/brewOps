"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTrends } from "@/lib/client-api";
import { STATUS_META, fmtDateTime } from "@/lib/status";
import type { MachineTrend, Status, TrendsData } from "@/lib/types";
import { StatusBadge } from "@/components/brewops/status-badge";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  Activity, ArrowDownRight, ArrowUpRight, CheckCircle2, Eye, LoaderCircle,
  Timer, TriangleAlert, Wrench, XCircle,
} from "lucide-react";

const VERDICT_META: Record<string, { label: string; chip: string; icon: typeof Eye }> = {
  FINE: { label: "Trending fine", chip: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  WATCH: { label: "Watch", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Eye },
  DEGRADING: { label: "Degrading", chip: "bg-red-500/15 text-red-400 border-red-500/30", icon: TriangleAlert },
};

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(11,15,20,0.96)",
  border: "1px solid #2b3442",
  borderRadius: 10,
  fontSize: 11,
  color: "#e5e7eb",
  padding: "6px 10px",
};

function dayLabel(d: string) { return `${d.slice(8)}/${d.slice(5, 7)}`; }

function fmtMins(m: number) {
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Tiny dependency-free SVG sparkline */
function Spark({ values }: { values: number[] }) {
  const w = 92, h = 26;
  const lo = Math.min(...values, 92);
  const hi = 100;
  const span = Math.max(0.001, hi - lo);
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - ((v - lo) / span) * (h - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = values[values.length - 1] ?? 100;
  const first = values[0] ?? 100;
  const stroke = last < first - 0.5 ? "#f87171" : last > first + 0.5 ? "#34d399" : "#fbbf24";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className="shrink-0">
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={stroke} opacity="0.12" />
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
    </svg>
  );
}

function DirectionArrow({ dir }: { dir: string }) {
  if (dir === "IMPROVING") return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" aria-label="Improving" />;
  if (dir === "WORSENING") return <ArrowDownRight className="h-3.5 w-3.5 text-red-400" aria-label="Worsening" />;
  return <span className="inline-block h-3.5 w-3.5 text-center text-[10px] leading-4 text-muted-foreground" aria-label="Stable">–</span>;
}

export default function TrendsView() {
  const [days, setDays] = useState(14);
  const [machineId, setMachineId] = useState<string | null>(null);
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number, mid: string | null) => {
    setLoading(true);
    try { setData(await fetchTrends(d, mid)); }
    catch { /* keep last good data */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(days, machineId); }, [days, machineId, load]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const rank = { DEGRADING: 0, WATCH: 1, FINE: 2 } as const;
    return [...data.machines].sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.uptime7 - b.uptime7);
  }, [data]);

  const kpis = data?.kpis;
  const detail = data?.detail ?? null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header + range */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Reliability Trends
          </h1>
          <p className="text-xs text-muted-foreground">
            Is each machine trending fine, or heading for a breakdown? Uptime, faults & downtime from the daily rounds.
          </p>
        </div>
        <div className="flex rounded-xl border border-border bg-card p-1" role="group" aria-label="Trend window">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`h-8 px-3.5 rounded-lg text-xs font-bold transition-colors ${days === d ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={days === d}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <div className="rounded-xl border border-border bg-card p-3 md:p-4">
          <Activity className="h-4 w-4 text-emerald-400 mb-1" />
          <p className="text-lg md:text-2xl font-bold leading-none font-mono tabular-nums">{kpis ? kpis.uptimePct.toFixed(1) : "–"}<span className="text-xs text-muted-foreground">%</span></p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">Fleet uptime · {days}d</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 md:p-4">
          <Timer className="h-4 w-4 text-red-400 mb-1" />
          <p className="text-lg md:text-2xl font-bold leading-none font-mono tabular-nums">{kpis ? kpis.downtimeHours.toFixed(1) : "–"}<span className="text-xs text-muted-foreground">h</span></p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">Lost production hours</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 md:p-4">
          <TriangleAlert className="h-4 w-4 text-amber-400 mb-1" />
          <p className="text-lg md:text-2xl font-bold leading-none font-mono tabular-nums">{kpis?.faultEvents ?? "–"}</p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">Fault events</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 md:p-4">
          <Wrench className="h-4 w-4 text-teal-400 mb-1" />
          <p className="text-lg md:text-2xl font-bold leading-none font-mono tabular-nums">{kpis?.mttrHours != null ? kpis.mttrHours.toFixed(1) : "–"}<span className="text-xs text-muted-foreground">h</span></p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">MTTR · avg repair</p>
        </div>
      </section>

      {/* Fleet charts */}
      <section className="grid md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-3 md:p-4">
          <p className="text-xs font-bold mb-2">Fleet uptime · last {days} days</p>
          <div className="h-44">
            {data && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.fleetDaily} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="upFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fontSize: 9, fill: "#71717a" }} domain={[(min: number) => Math.max(0, Math.floor(min / 5) * 5 - 5), 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string) => [`${Number(v).toFixed(1)}%`, "Uptime"]} labelFormatter={(l) => String(l)} />
                  <ReferenceLine y={97} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Area type="monotone" dataKey="uptimePct" stroke="#fbbf24" strokeWidth={2} fill="url(#upFill)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground mt-1">Dashed line = 97% target. Drops below mean the floor felt it.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 md:p-4">
          <p className="text-xs font-bold mb-2">Downtime per day · all machines (min)</p>
          <div className="h-44">
            {data && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.fleetDaily} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string) => [fmtMins(Number(v)), "Down"]} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="downtimeMin" fill="#f87171" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground mt-1">Auto-built from BROKEN reports + repair closures. No typing.</p>
        </div>
      </section>

      {/* Trending board + detail */}
      <section className="grid lg:grid-cols-5 gap-3 items-start">
        {/* machine list */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-bold">Machines · trending verdict</p>
            {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="divide-y divide-border max-h-[560px] overflow-y-auto brewops-scroll">
            {sorted.map((m) => (
              <MachineRow key={m.machineId} m={m} active={machineId === m.machineId} onClick={() => setMachineId(machineId === m.machineId ? null : m.machineId)} />
            ))}
            {sorted.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No machines assigned yet.</p>}
          </div>
        </div>

        {/* detail */}
        <div className="lg:col-span-3">
          {detail ? (
            <MachineDetail detail={detail} />
          ) : (
            <div className="rounded-2xl border border-border bg-card/40 p-8 text-center">
              <Activity className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-semibold">Select a machine to see its trend</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Uptime & downtime history, status mix, worst components and every downtime incident. The same evidence the morning meeting uses.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MachineRow({ m, active, onClick }: { m: MachineTrend; active: boolean; onClick: () => void }) {
  const meta = VERDICT_META[m.verdict];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 md:px-4 py-3 transition-colors ${active ? "bg-primary/10" : "hover:bg-accent/40"}`}
      aria-expanded={active}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-primary">{m.code}</span>
            <span className="text-[13px] font-semibold truncate">{m.name}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${meta.chip}`}>
              <Icon className="h-2.5 w-2.5" /> {meta.label}
            </span>
            <DirectionArrow dir={m.direction} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {m.topIssue ? `Repeat offender: ${m.topIssue}` : "No repeat faults this window"}
            {m.currentIssueCount > 0 ? ` · ${m.currentIssueCount} open issue${m.currentIssueCount > 1 ? "s" : ""}` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-bold font-mono tabular-nums leading-none ${m.uptime7 < 95 ? "text-red-400" : m.uptime7 < 97.5 ? "text-amber-300" : "text-emerald-400"}`}>{m.uptime7.toFixed(1)}%</p>
          <p className="text-[9px] text-muted-foreground mt-0.5">7d vs {m.uptimePrev7.toFixed(1)}%</p>
        </div>
        <Spark values={m.spark} />
      </div>
    </button>
  );
}

function MachineDetail({ detail }: { detail: NonNullable<TrendsData["detail"]> }) {
  const { machine: m, daily, statusMix, components, incidents } = detail;
  const meta = VERDICT_META[m.verdict];
  const Icon = meta.icon;
  const maxMix = Math.max(1, ...statusMix.map((s) => s.count));

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-bold"><span className="font-mono text-primary mr-1.5">{m.code}</span>{m.name}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{m.departmentName} · {m.ownerName ? `owner ${m.ownerName}` : "no owner"} · last {m.spark.length} days</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold ${meta.chip}`}>
            <Icon className="h-3 w-3" /> {meta.label} · {m.direction.toLowerCase()}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3">
          <div className="rounded-lg bg-secondary/60 px-2 py-1.5 text-center">
            <p className={`text-sm font-bold font-mono tabular-nums ${m.uptimePct < 95 ? "text-red-400" : "text-emerald-400"}`}>{m.uptimePct.toFixed(1)}%</p>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wide">uptime</p>
          </div>
          <div className="rounded-lg bg-secondary/60 px-2 py-1.5 text-center">
            <p className="text-sm font-bold font-mono tabular-nums">{fmtMins(m.downtimeMin7)}</p>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wide">down 7d</p>
          </div>
          <div className="rounded-lg bg-secondary/60 px-2 py-1.5 text-center">
            <p className="text-sm font-bold font-mono tabular-nums">{m.faults7}<span className="text-[9px] text-muted-foreground"> /{m.faultsPrev7}</span></p>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wide">faults 7d/prev</p>
          </div>
          <div className="rounded-lg bg-secondary/60 px-2 py-1.5 text-center">
            <p className="text-sm font-bold font-mono tabular-nums">{m.currentIssueCount}</p>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wide">open now</p>
          </div>
        </div>
        <div className="h-40 mt-3 -ml-4 md:ml-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 4, right: -8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 9, fill: "#71717a" }} interval="preserveStartEnd" minTickGap={14} />
              <YAxis yAxisId="u" tick={{ fontSize: 9, fill: "#71717a" }} domain={[(min: number) => Math.max(0, Math.floor(min / 5) * 5 - 5), 100]} />
              <YAxis yAxisId="d" orientation="right" tick={{ fontSize: 9, fill: "#71717a" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => String(l)} />
              <Bar yAxisId="d" dataKey="downtimeMin" name="Downtime (min)" fill="rgba(248,113,113,0.55)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="u" type="monotone" dataKey="uptimePct" name="Uptime %" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* status mix */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold mb-2.5">Status mix · all checks in window</p>
          <div className="space-y-1.5">
            {statusMix.length === 0 && <p className="text-[11px] text-muted-foreground">No checks recorded in this window.</p>}
            {statusMix.map((s) => {
              const metaS = STATUS_META[s.status as Status];
              return (
                <div key={s.status} className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold w-24 shrink-0 truncate">{metaS?.label ?? s.status}</span>
                  <div className="flex-1 h-3.5 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${metaS?.dot ?? "bg-zinc-500"}`} style={{ width: `${(s.count / maxMix) * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums w-8 text-right text-muted-foreground">{s.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* incidents */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold mb-2.5 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-400" /> Downtime incidents</p>
          <div className="space-y-1.5 max-h-44 overflow-y-auto brewops-scroll">
            {incidents.length === 0 && <p className="text-[11px] text-muted-foreground">Zero downtime in this window. Trending fine.</p>}
            {incidents.map((i) => (
              <div key={i.id} className="rounded-lg bg-secondary/50 px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium truncate min-w-0 flex-1">{i.reason}</p>
                  {i.open ? (
                    <span className="text-[9px] font-bold text-red-400 shrink-0 animate-pulse">OPEN</span>
                  ) : (
                    <span className="text-[9px] font-mono text-muted-foreground shrink-0">{fmtMins(i.minutes)}</span>
                  )}
                </div>
                <p className="text-[9px] text-muted-foreground">{fmtDateTime(i.startedAt)}{i.endedAt ? ` → ${fmtDateTime(i.endedAt)}` : " → ongoing"}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* component reliability */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <p className="text-xs font-bold px-4 py-3 border-b border-border">Component reliability · clean-check rate</p>
        <div className="max-h-72 overflow-y-auto brewops-scroll">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-card">
              <tr className="text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-semibold">Component</th>
                <th className="px-2 py-2 font-semibold">Now</th>
                <th className="px-2 py-2 font-semibold text-right">Checks</th>
                <th className="px-2 py-2 font-semibold text-right">Faults</th>
                <th className="px-4 py-2 font-semibold text-right w-28">Clean %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {[...components].sort((a, b) => a.cleanPct - b.cleanPct).map((c) => (
                <tr key={c.id} className="text-[11px]">
                  <td className="px-4 py-2">
                    <p className="font-medium truncate max-w-[180px]">{c.name}{c.partCode ? <span className="text-muted-foreground font-mono text-[9px] ml-1">{c.partCode}</span> : null}</p>
                    {c.lastNote && <p className="text-[9px] text-muted-foreground truncate max-w-[200px]">{c.lastNote}</p>}
                  </td>
                  <td className="px-2 py-2"><StatusBadge status={c.currentStatus} size="xs" /></td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{c.logs}</td>
                  <td className={`px-2 py-2 text-right font-mono tabular-nums ${c.faults > 2 ? "text-red-400 font-bold" : c.faults > 0 ? "text-amber-300" : "text-muted-foreground"}`}>{c.faults}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5 justify-end">
                      <div className="h-1.5 w-14 rounded-full bg-secondary overflow-hidden">
                        <div className={`h-full rounded-full ${c.cleanPct >= 95 ? "bg-emerald-500" : c.cleanPct >= 85 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${c.cleanPct}%` }} />
                      </div>
                      <span className="font-mono tabular-nums text-[10px] w-8 text-right">{c.cleanPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

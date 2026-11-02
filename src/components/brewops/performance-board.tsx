"use client";

// Artisan effectiveness board — WHO gets tasks done, and how fast.
// Ranks every artisan by a 0–100 score: on-time delivery (40%),
// verified machine evidence (30%) and task speed vs the plant average (30%).
// Lives on the Engineer's Trends tab; re-fetches when the range changes.
import { useEffect, useState } from "react";
import { fetchPerformance, type PerformanceRow } from "@/lib/client-api";
import { LoaderCircle, Trophy, Timer, Medal } from "lucide-react";

type PerfData = Awaited<ReturnType<typeof fetchPerformance>>;

function hLabel(h: number) {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}

const RANK_STYLE = [
  "border-amber-500/50 bg-amber-500/15 text-amber-400",
  "border-zinc-400/40 bg-zinc-400/10 text-zinc-300",
  "border-orange-700/40 bg-orange-700/10 text-orange-400",
];

export default function PerformanceBoard({ days }: { days: number }) {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchPerformance(days)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  const rows = data?.rows ?? [];

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Trophy className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">Artisan effectiveness</p>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Who gets tasks done fastest — score = on-time 40% + verified evidence 30% + speed vs plant average 30%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.plantAvgHours != null && (
            <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[10px] font-bold text-muted-foreground inline-flex items-center gap-1">
              <Timer className="h-3 w-3" /> plant avg {hLabel(data.plantAvgHours)} / task
            </span>
          )}
          {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {!loading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-8">
          No artisans registered yet — add them from the Team page.
        </p>
      )}
      {!loading && rows.length > 0 && rows.every((r) => r.completed === 0) && (
        <p className="text-xs text-muted-foreground text-center py-6 px-4">
          No completed work orders in the last {days} days yet. Once artisans start completing tasks,
          this board ranks them by time taken, punctuality and evidence quality.
        </p>
      )}

      <div className="divide-y divide-border/70">
        {rows.map((r, i) => (
          <PerfRow key={r.userId} r={r} rank={i + 1} top={i === 0 && r.score !== null} />
        ))}
      </div>
    </section>
  );
}

function PerfRow({ r, rank, top }: { r: PerformanceRow; rank: number; top: boolean }) {
  const scoreCls = r.score === null ? "bg-secondary" : r.score >= 80 ? "bg-emerald-500" : r.score >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={`px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${top ? "bg-amber-500/5" : ""} ${r.active ? "" : "opacity-50"}`}>
      <span className={`h-7 w-7 rounded-full border flex items-center justify-center text-[11px] font-bold shrink-0 ${RANK_STYLE[rank - 1] ?? "border-border bg-secondary/60 text-muted-foreground"}`}>
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-tight flex items-center gap-2 flex-wrap">
          {r.name}
          {top && (
            <span className="rounded-full border border-amber-500/50 bg-amber-500/15 text-amber-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide inline-flex items-center gap-1">
              <Medal className="h-2.5 w-2.5" /> Most effective
            </span>
          )}
          {!r.active && <span className="text-[9px] font-bold text-muted-foreground">deactivated</span>}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {r.trade ? `${r.trade.toLowerCase()} · ` : ""}{r.shift ? `shift ${r.shift} · ` : ""}
          {r.completed} completed{r.open > 0 ? ` · ${r.open} on their desk` : ""}
          {r.overdue > 0 ? <span className="text-red-400 font-semibold"> · {r.overdue} overdue</span> : ""}
        </p>
      </div>

      <div className="flex items-center gap-4 sm:gap-5 shrink-0">
        <Metric label="avg time" value={r.avgHours !== null ? hLabel(r.avgHours) : "–"}
          hint={r.speedPct !== null ? (r.speedPct >= 100 ? `${r.speedPct}% of avg ⚡` : `${r.speedPct}% of avg`) : undefined}
          cls={r.speedPct !== null && r.speedPct >= 100 ? "text-emerald-400" : undefined} />
        <Metric label="on time" value={r.onTimePct !== null ? `${r.onTimePct}%` : "–"} />
        <Metric label="verified" value={r.verifiedPct !== null ? `${r.verifiedPct}%` : "–"} />
        <div className="w-16 text-right">
          <p className="text-sm font-bold font-mono tabular-nums leading-none">{r.score !== null ? r.score : "–"}</p>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden mt-1">
            <div className={`h-full rounded-full ${scoreCls}`} style={{ width: `${r.score ?? 0}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint, cls }: { label: string; value: string; hint?: string; cls?: string }) {
  return (
    <div className={`text-right w-14 ${cls ?? ""}`}>
      <p className="text-[13px] font-bold font-mono tabular-nums leading-none">{value}</p>
      <p className="text-[8.5px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
      {hint && <p className="text-[8px] text-muted-foreground leading-tight mt-0.5 whitespace-nowrap">{hint}</p>}
    </div>
  );
}
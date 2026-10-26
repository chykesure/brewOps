"use client";

// Trends tab — the plant's usage heartbeat over the last 7/14/30 days:
// status logs per day, work orders created vs completed, downtime events.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, ClipboardList, LoaderCircle, Timer } from "lucide-react";
import { devTrends, type DevTrends } from "@/lib/client-api";
import { SectionCard } from "./shared";

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(11,15,20,0.96)",
  border: "1px solid #2b3442",
  borderRadius: 10,
  fontSize: 11,
  color: "#e5e7eb",
  padding: "6px 10px",
};

function dayLabel(d: string) { return `${d.slice(8)}/${d.slice(5, 7)}`; }

const WINDOWS = [7, 14, 30] as const;

export default function TrendsTab({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<DevTrends | null>(null);
  const [days, setDays] = useState<number>(14);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (w: number, silent = false) => {
    if (!silent) setBusy(true);
    try {
      const t = await devTrends(w);
      setData(t);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load trends");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const series = data?.series ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Usage heartbeat — how the floor is actually using BrewOps.</p>
        <div className="flex rounded-xl border border-border bg-secondary/50 p-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${days === w ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {busy && !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <LoaderCircle className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { label: "Status logs", v: data?.totals.logs ?? "-" },
              { label: "WOs created", v: data?.totals.wosCreated ?? "-" },
              { label: "WOs completed", v: data?.totals.wosCompleted ?? "-" },
              { label: "Downtime events", v: data?.totals.downtimes ?? "-" },
              { label: "Check-ins", v: data?.totals.checkIns ?? "-" },
              { label: "Escalations", v: data?.totals.escalations ?? "-" },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl border border-border bg-card p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t.label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{t.v}</p>
                <p className="text-[10px] text-muted-foreground">last {days} days</p>
              </div>
            ))}
          </div>

          <SectionCard icon={Activity} title="Status logging activity" desc="Reports filed from the floor per day — the app's vital sign.">
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gLogs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary, #f59e0b)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--color-primary, #f59e0b)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#232b36" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 10, fill: "#8b93a1" }} axisLine={{ stroke: "#232b36" }} tickLine={false} minTickGap={18} />
                  <YAxis tick={{ fontSize: 10, fill: "#8b93a1" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => String(l)} />
                  <Area type="monotone" dataKey="logs" name="Status logs" stroke="var(--color-primary, #f59e0b)" strokeWidth={2} fill="url(#gLogs)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard icon={ClipboardList} title="Work orders — created vs completed" desc="Dispatch pace against completion pace. A widening gap means work is piling up.">
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#232b36" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 10, fill: "#8b93a1" }} axisLine={{ stroke: "#232b36" }} tickLine={false} minTickGap={18} />
                  <YAxis tick={{ fontSize: 10, fill: "#8b93a1" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="wosCreated" name="Created" fill="#8b93a1" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Line type="monotone" dataKey="wosCompleted" name="Completed" stroke="#10b981" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard icon={Timer} title="Downtime events" desc="Stoppages reported per day — spikes point at the painful machines.">
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#232b36" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 10, fill: "#8b93a1" }} axisLine={{ stroke: "#232b36" }} tickLine={false} minTickGap={18} />
                  <YAxis tick={{ fontSize: 10, fill: "#8b93a1" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="downtimes" name="Downtime events" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

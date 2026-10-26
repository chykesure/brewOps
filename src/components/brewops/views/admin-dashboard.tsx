"use client";

import { useEffect, useState } from "react";
import type { BootstrapData, EscalationDTO, MachineDTO, WorkOrderDTO } from "@/lib/types";
import type { TrendsData } from "@/lib/types";
import { ESCALATION_META } from "@/lib/types";
import { fetchTrends, woAction, downtimeAction, escalationAction } from "@/lib/client-api";
import { StatusBadge } from "@/components/brewops/status-badge";
import { STATUS_META, fmtTime, timeAgo } from "@/lib/status";
import { toast } from "sonner";
import {
  AlertTriangle, ChevronRight, Gauge, CheckCircle2, PackageX, Radar,
  Timer, ArrowRightLeft, CalendarClock, XCircle, PackageOpen, Wrench,
  Activity, Siren, ShieldCheck, Megaphone, Zap, CheckCheck, Bell, Hourglass, BadgeCheck, FileText,
} from "lucide-react";

const VERDICT_CHIP: Record<string, string> = {
  FINE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  WATCH: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  DEGRADING: "bg-red-500/15 text-red-400 border-red-500/30",
};
const VERDICT_LABEL: Record<string, string> = { FINE: "Fine", WATCH: "Watch", DEGRADING: "Degrading" };

function MachineLedStrip({ machine }: { machine: MachineDTO }) {
  const comps = machine.components;
  const alerting = comps.filter((c) => STATUS_META[c.currentStatus]?.alert).length;
  return (
    <div className="min-w-[130px] rounded-xl border border-border bg-secondary/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-bold text-primary truncate">{machine.code}</p>
        {alerting > 0 && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" aria-label="alerting" />}
      </div>
      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{machine.name}</p>
      <div className="flex gap-1 mt-1.5 flex-wrap" aria-label={`${comps.length} components`}>
        {comps.map((c) => (
          <span
            key={c.id}
            title={`${c.name} · ${STATUS_META[c.currentStatus]?.label ?? c.currentStatus}`}
            className={`h-2.5 w-2.5 rounded-[3px] ${STATUS_META[c.currentStatus]?.dot ?? "bg-zinc-500"} ${alerting > 0 && STATUS_META[c.currentStatus]?.alert ? "animate-pulse" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

function MiniSpark({ values }: { values: number[] }) {
  const w = 72, h = 20;
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
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export default function AdminDashboard({
  data, refresh, onGoMachines, onGoWork, onGoTrends, onGoTeam, onGoReports, onGoProfile,
}: {
  data: BootstrapData;
  refresh: () => void;
  onGoMachines: () => void;
  onGoWork: () => void;
  onGoTrends: () => void;
  onGoTeam: () => void;
  onGoReports: () => void;
  onGoProfile: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [extendFor, setExtendFor] = useState<WorkOrderDTO | null>(null);
  const [newDue, setNewDue] = useState("");
  const [reassignFor, setReassignFor] = useState<WorkOrderDTO | null>(null);
  const [trends, setTrends] = useState<TrendsData | null>(null);
  // Escalation loop — artisan feedback needing the Engineer
  const [quickFixFor, setQuickFixFor] = useState<EscalationDTO | null>(null);
  const [qfPriority, setQfPriority] = useState("HIGH");
  const [qfDueHours, setQfDueHours] = useState(24);
  const [qfAssignee, setQfAssignee] = useState("");
  const [rerouteEscFor, setRerouteEscFor] = useState<EscalationDTO | null>(null);
  const [resolveFor, setResolveFor] = useState<EscalationDTO | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  useEffect(() => {
    let alive = true;
    fetchTrends(7).then((t) => { if (alive) setTrends(t); }).catch(() => null);
    return () => { alive = false; };
  }, []);

  const overdueWos = data.alerts.filter((a) => a.kind === "OVERDUE_WO");
  const statusAlerts = data.alerts.filter((a) => a.kind === "STATUS");
  const stockAlerts = data.alerts.filter((a) => a.kind === "LOW_STOCK");
  const approvalAlerts = data.alerts.filter((a) => a.kind === "APPROVAL");
  const criticalCount = data.alerts.filter((a) => a.severity === "CRITICAL").length;

  const roundPct = data.stats.totalComponents ? Math.round((data.stats.reportedToday / data.stats.totalComponents) * 100) : 0;

  const doAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(id + action);
    try {
      await woAction(id, { action, ...extra });
      toast.success(action === "reassign" ? "Work order reassigned" : "Deadline extended");
      setExtendFor(null);
      setReassignFor(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const closeDowntime = async (id: string) => {
    setBusy(id);
    try {
      await downtimeAction({ id }, true);
      toast.success("Downtime closed");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const woById = (refId: string) => data.workOrders.find((w) => w.id === refId);

  // ---- Escalation actions ----
  const escAction = async (escId: string, action: string, extra?: Record<string, unknown>, msg?: string) => {
    setBusy(escId + action);
    try {
      const res = await escalationAction(escId, { action, ...extra });
      toast.success(
        msg ?? (res.reroutedTo ? `Job rerouted to ${res.reroutedTo}` : res.woCode ? `Quick-fix ${res.woCode} dispatched` : "Escalation updated"),
      );
      setQuickFixFor(null);
      setRerouteEscFor(null);
      setResolveFor(null);
      setResolveNote("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const openQuickFix = (esc: EscalationDTO) => {
    setQuickFixFor(esc);
    setQfPriority(esc.severity === "CRITICAL" ? "URGENT" : "HIGH");
    setQfDueHours(esc.severity === "CRITICAL" ? 4 : 24);
    setQfAssignee(esc.workOrderId ? (data.workOrders.find((w) => w.id === esc.workOrderId)?.assignedToId ?? "") : "");
  };

  // Spares context for NEEDS_SPARES escalations — the Engineer answers "is the part even in store?"
  const partInfoFor = (esc: EscalationDTO) => {
    if (!esc.componentId) return null;
    const comp = data.machines.flatMap((m) => m.components).find((c) => c.id === esc.componentId);
    if (!comp?.partCode) return null;
    return data.parts.find((p) => p.code === comp.partCode) ?? null;
  };

  const openEscs = data.escalations.filter((e) => e.status === "OPEN")
    .sort((a, b) => ({ CRITICAL: 0, HIGH: 1, NORMAL: 2 } as const)[a.severity] - ({ CRITICAL: 0, HIGH: 1, NORMAL: 2 } as const)[b.severity] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const handledEscs = data.escalations.filter((e) => e.status !== "OPEN");

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold tracking-tight">Command Center</h1>
        <p className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · live from the floor
        </p>
      </div>

      {/* Andon strip — line-wide critical banner */}
      {criticalCount > 0 && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-3.5 py-2.5 flex items-center gap-3" role="alert">
          <Siren className="h-5 w-5 text-red-400 animate-pulse shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-red-300 leading-tight">
              ANDON · {criticalCount} critical state{criticalCount > 1 ? "s" : ""} on the floor
            </p>
            <p className="text-[10px] text-red-300/80 truncate">
              {data.alerts.filter((a) => a.severity === "CRITICAL").slice(0, 3).map((a) => a.machineCode ?? a.title.split(" ")[0]).join(" · ")}
              {criticalCount > 3 ? " …" : ""} · engineer attention required now
            </p>
          </div>
          <span className="hidden sm:inline text-[9px] font-mono text-red-300/70 shrink-0">{new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      )}

      {/* KPI row — every tile opens the section it counts */}
      <section className="grid grid-cols-4 gap-2 md:gap-3">
        <button onClick={onGoMachines} className={`rounded-xl border p-2.5 md:p-4 text-left transition-colors ${criticalCount ? "border-red-500/40 bg-red-500/10 hover:bg-red-500/15" : "border-border bg-card hover:bg-accent/40"}`}>
          <AlertTriangle className={`h-4 w-4 md:h-5 md:w-5 mb-1 ${criticalCount ? "text-red-400" : "text-muted-foreground"}`} />
          <p className={`text-base md:text-xl font-bold leading-none ${criticalCount ? "text-red-400" : ""}`}>{criticalCount}</p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">Critical</p>
        </button>
        <button onClick={onGoWork} className="rounded-xl border border-border bg-card p-2.5 md:p-4 text-left hover:bg-accent/40 transition-colors">
          <Gauge className="h-4 w-4 md:h-5 md:w-5 text-primary mb-1" />
          <p className="text-base md:text-xl font-bold leading-none">{data.stats.openWorkOrders}</p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">Open WOs</p>
        </button>
        <button onClick={onGoWork} className={`rounded-xl border p-2.5 md:p-4 text-left transition-colors ${data.stats.pendingApprovalCount ? "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15" : "border-border bg-card hover:bg-accent/40"}`}>
          <Hourglass className={`h-4 w-4 md:h-5 md:w-5 mb-1 ${data.stats.pendingApprovalCount ? "text-amber-400 animate-pulse" : "text-muted-foreground"}`} />
          <p className={`text-base md:text-xl font-bold leading-none ${data.stats.pendingApprovalCount ? "text-amber-400" : ""}`}>{data.stats.pendingApprovalCount}</p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">To approve</p>
        </button>
        <button onClick={onGoTrends} className="rounded-xl border border-border bg-card p-2.5 md:p-4 text-left hover:bg-accent/40 transition-colors">
          <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 text-emerald-400 mb-1" />
          <p className="text-base md:text-xl font-bold leading-none">{data.stats.completionRate7d}%</p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">7d compl.</p>
        </button>
      </section>

      {/* Down machines + closure rate strip — both tiles navigate */}
      <section className="grid grid-cols-2 gap-2 md:gap-3">
        <button onClick={onGoMachines} className="rounded-xl border border-border bg-card p-2.5 md:p-4 text-left hover:bg-accent/40 transition-colors">
          <XCircle className="h-4 w-4 md:h-5 md:w-5 text-red-400 mb-1" />
          <p className="text-base md:text-xl font-bold leading-none">{data.stats.downComponents}</p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">Components down</p>
        </button>
        <button onClick={onGoReports} className="rounded-xl border border-border bg-card p-2.5 md:p-4 text-left hover:bg-accent/40 transition-colors">
          <FileText className="h-4 w-4 md:h-5 md:w-5 text-primary mb-1" />
          <p className="text-base md:text-xl font-bold leading-none">{data.stats.closureRate == null ? "–" : `${data.stats.closureRate}%`}</p>
          <p className="text-[9px] md:text-xs text-muted-foreground mt-1">Closure rate · 30d</p>
        </button>
      </section>

      {/* Evidence-chain strip — on-site proof on completed work */}
      <section className="rounded-xl border border-border bg-card px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
        <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
        <p className="text-[11px] text-muted-foreground flex-1 min-w-[200px] leading-snug">
          <b className="text-foreground">{data.stats.verifiedRate7d == null ? "no data yet" : `${data.stats.verifiedRate7d}%`}</b> of work orders completed in the last 7 days carry on-site proof (check-in + photos)
        </p>
        {data.stats.flaggedCount > 0 && (
          <button onClick={onGoWork} className="rounded-lg bg-red-500/15 border border-red-500/40 text-red-400 px-2.5 py-1 text-[10px] font-bold hover:bg-red-500/25 transition-colors">
            {data.stats.flaggedCount} flagged · review
          </button>
        )}
      </section>

      {/* Artisan feedback — escalations with quick-fix & reroute actions */}
      <section>
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <Megaphone className={`h-4 w-4 ${openEscs.length ? "text-amber-400" : "text-muted-foreground"}`} /> Artisan feedback · escalations
          </h2>
          {openEscs.length > 0 ? (
            <span className="rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 px-2.5 py-1 text-[10px] font-bold animate-pulse">
              {openEscs.length} need{openEscs.length === 1 ? "s" : ""} action
            </span>
          ) : (
            <span className="text-[10px] font-medium text-emerald-400">floor is quiet</span>
          )}
        </div>
        {openEscs.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-xl border border-border bg-card p-4 text-center">
            No open escalations. When an artisan raises a hand on the floor, it lands here with quick-fix and reroute actions.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 md:items-start">
            {openEscs.map((esc) => {
              const wo = esc.workOrderId ? woById(esc.workOrderId) : undefined;
              const part = partInfoFor(esc);
              const critical = esc.severity === "CRITICAL";
              return (
                <div
                  key={esc.id}
                  className={`rounded-2xl border p-3.5 ${critical ? "border-red-500/50 bg-red-500/5" : "border-amber-500/40 bg-amber-500/5"}`}
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold leading-tight flex items-center gap-1.5 flex-wrap">
                        {critical && <Siren className="h-3.5 w-3.5 text-red-400 animate-pulse shrink-0" />}
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${critical ? "border-red-500/40 text-red-300 bg-red-500/10" : "border-amber-500/40 text-amber-300 bg-amber-500/10"}`}>
                          {ESCALATION_META[esc.category].label}
                        </span>
                        <span className="font-mono text-[10px] text-primary">{esc.machineCode}</span>
                        {esc.componentName && <span className="truncate">{esc.componentName}</span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{esc.message}</p>
                      <p className="text-[9px] text-muted-foreground mt-1.5 flex items-center gap-1 flex-wrap">
                        <Megaphone className="h-2.5 w-2.5" />
                        {esc.raisedByName} · {timeAgo(esc.createdAt)}
                        {esc.workOrderCode && <> · job {esc.workOrderCode}</>}
                      </p>
                      {esc.category === "NEEDS_SPARES" && part && (
                        <p className={`mt-1.5 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold ${part.stock === 0 ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"}`}>
                          <PackageOpen className="h-3 w-3" /> {part.code}: {part.stock === 0 ? "OUT OF STOCK" : `${part.stock} in store`}
                        </p>
                      )}
                    </div>
                    {esc.photo && <img src={esc.photo} alt="Issue" className="h-14 w-14 rounded-lg object-cover border border-border shrink-0" />}
                  </div>
                  <div className="mt-2.5 flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => openQuickFix(esc)}
                      disabled={busy !== null}
                      className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[11px] font-bold flex items-center gap-1.5 hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      <Zap className="h-3 w-3" /> Quick fix
                    </button>
                    <button
                      onClick={() => setRerouteEscFor(esc)}
                      disabled={busy !== null || !esc.workOrderId}
                      title={esc.workOrderId ? "Hand the linked job to another artisan" : "No linked job. Use Quick fix"}
                      className="h-8 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold flex items-center gap-1.5 hover:bg-accent transition-colors disabled:opacity-40"
                    >
                      <ArrowRightLeft className="h-3 w-3" /> Reroute job
                    </button>
                    <button
                      onClick={() => escAction(esc.id, "ack")}
                      disabled={busy !== null}
                      className="h-8 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold flex items-center gap-1.5 hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Bell className="h-3 w-3" /> Ack
                    </button>
                    <button
                      onClick={() => { setResolveFor(esc); setResolveNote(""); }}
                      disabled={busy !== null}
                      className="h-8 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold flex items-center gap-1.5 hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <CheckCheck className="h-3 w-3" /> Resolve
                    </button>
                    {wo && (
                      <button onClick={onGoWork} className="h-8 px-3 rounded-lg text-[11px] font-semibold text-primary flex items-center gap-1 hover:underline">
                        Open <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Handled — the loop is closed, visible for traceability */}
        {handledEscs.length > 0 && (
          <div className="mt-2 rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {handledEscs.slice(0, 4).map((esc) => (
              <div key={esc.id} className="px-3 py-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold truncate">
                    {ESCALATION_META[esc.category].label} · {esc.machineCode}{esc.componentName ? ` · ${esc.componentName}` : ""}
                  </p>
                  {esc.response && <p className="text-[10px] text-cyan-300/90 truncate">{esc.response}</p>}
                </div>
                <span className={`text-[9px] font-bold shrink-0 ${esc.status === "ACK" ? "text-cyan-300" : "text-emerald-400"}`}>
                  {esc.status === "ACK" ? "ACTING" : "RESOLVED"} · {timeAgo(esc.handledAt ?? esc.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Today's rounds */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><Radar className="h-4 w-4 text-primary" /> Today&apos;s status round</h2>
          <span className="text-xs font-bold">{data.stats.reportedToday}/{data.stats.totalComponents}</span>
        </div>
        <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
          <div className={`h-full rounded-full transition-all ${roundPct === 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${roundPct}%` }} />
        </div>
        {data.notReportedToday.length > 0 && roundPct < 100 && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Not yet reported</p>
            <div className="grid gap-1 md:grid-cols-2">
              {data.notReportedToday.slice(0, 5).map((m) => (
                <button key={m.machineId} onClick={onGoMachines} className="w-full flex items-center justify-between rounded-lg bg-secondary/60 px-2.5 py-1.5 hover:bg-accent/50 transition-colors text-left">
                  <span className="text-[11px] font-medium">{m.machineCode} {m.machineName}</span>
                  <span className="text-[10px] text-muted-foreground">{m.components.length} missing</span>
                </button>
              ))}
              {data.notReportedToday.length > 5 && (
                <p className="text-[10px] text-muted-foreground text-center">+{data.notReportedToday.length - 5} more machines</p>
              )}
            </div>
          </div>
        )}
        {roundPct === 100 && (
          <p className="text-[11px] text-emerald-400 mt-2.5 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Full round complete. Report is live and audit-ready.
          </p>
        )}
      </section>

      {/* Fleet mimic — one LED tile per machine */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><Gauge className="h-4 w-4 text-primary" /> Line status board</h2>
          <span className="text-[9px] text-muted-foreground">one LED per component · tap to manage</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          {data.machines.slice(0, 12).map((m) => (
            <button key={m.id} onClick={onGoMachines} className="text-left hover:bg-accent/30 rounded-xl transition-colors">
              <MachineLedStrip machine={m} />
            </button>
          ))}
        </div>
      </section>

      {/* Trending board — which machines are heading for trouble */}
      {trends && trends.machines.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold flex items-center gap-1.5"><Activity className="h-4 w-4 text-primary" /> Trending · 7-day reliability</h2>
            <button onClick={onGoTrends} className="text-[11px] font-bold text-primary flex items-center gap-0.5 hover:underline">
              Open trends <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="rounded-lg bg-secondary/60 px-2.5 py-1 text-[10px] font-mono tabular-nums">uptime <b className={trends.kpis.uptimePct < 95 ? "text-red-400" : "text-emerald-400"}>{trends.kpis.uptimePct.toFixed(1)}%</b></span>
            <span className="rounded-lg bg-secondary/60 px-2.5 py-1 text-[10px] font-mono tabular-nums">lost <b className="text-foreground">{trends.kpis.downtimeHours.toFixed(1)}h</b></span>
            <span className="rounded-lg bg-secondary/60 px-2.5 py-1 text-[10px] font-mono tabular-nums">faults <b className="text-amber-300">{trends.kpis.faultEvents}</b></span>
            <span className="rounded-lg bg-secondary/60 px-2.5 py-1 text-[10px] font-mono tabular-nums">MTTR <b className="text-foreground">{trends.kpis.mttrHours != null ? `${trends.kpis.mttrHours.toFixed(1)}h` : "–"}</b></span>
          </div>
          <div className="grid gap-1.5 md:grid-cols-2">
            {[...trends.machines]
              .sort((a, b) => ({ DEGRADING: 0, WATCH: 1, FINE: 2 } as const)[a.verdict] - ({ DEGRADING: 0, WATCH: 1, FINE: 2 } as const)[b.verdict] || a.uptime7 - b.uptime7)
              .slice(0, 6)
              .map((m) => (
                <button key={m.machineId} onClick={onGoTrends} className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/30 px-3 py-2 hover:bg-accent/40 transition-colors text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] font-bold text-primary">{m.code}</span>
                      <span className="text-[11px] font-semibold truncate">{m.name}</span>
                      <span className={`rounded-full border px-1.5 py-px text-[8px] font-bold uppercase ${VERDICT_CHIP[m.verdict]}`}>{VERDICT_LABEL[m.verdict]}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground truncate">{m.topIssue ? `Repeat: ${m.topIssue}` : "No repeat faults"}</p>
                  </div>
                  <MiniSpark values={m.spark} />
                  <span className={`text-[11px] font-bold font-mono tabular-nums w-11 text-right ${m.uptime7 < 95 ? "text-red-400" : m.uptime7 < 97.5 ? "text-amber-300" : "text-emerald-400"}`}>{m.uptime7.toFixed(1)}%</span>
                </button>
              ))}
          </div>
        </section>
      )}

      {/* Alert panel */}
      <section>
        <h2 className="text-sm font-bold mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-red-400" /> Alert panel
          {overdueWos.length + statusAlerts.length + approvalAlerts.length === 0 && (
            <span className="text-[10px] font-medium text-emerald-400 normal-case">all quiet</span>
          )}
        </h2>
        {overdueWos.length + statusAlerts.length + approvalAlerts.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-xl border border-border bg-card p-4 text-center">
            No red flags. The dashboard speaks before the breakdown does. Today it&apos;s calm.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 md:items-start">
            {data.alerts.filter((a) => a.kind !== "LOW_STOCK" && a.kind !== "ESCALATION").map((a) => {
              const isStatus = a.kind === "STATUS";
              const wo = a.kind === "OVERDUE_WO" || a.kind === "APPROVAL" ? woById(a.refId) : undefined;
              const isApproval = a.kind === "APPROVAL";
              return (
                <div
                  key={a.kind + a.refId}
                  className={`rounded-xl border p-3 ${a.severity === "CRITICAL" ? "border-red-500/40 bg-red-500/5" : isApproval ? "border-amber-500/40 bg-amber-500/5" : "border-amber-500/40 bg-amber-500/5"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {isStatus ? (
                        <p className="text-[13px] font-bold leading-tight">{a.title.split(" · ")[0]}</p>
                      ) : (
                        <p className="text-[13px] font-bold leading-tight text-red-400">{a.title}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{a.detail}</p>
                      <p className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1">
                        {isStatus ? <PackageOpen className="h-2.5 w-2.5" /> : <CalendarClock className="h-2.5 w-2.5" />}
                        {a.kind === "OVERDUE_WO" ? `slipped past ${timeAgo(a.at)}` : timeAgo(a.at)}
                        {a.machineCode ? ` · ${a.machineCode}` : ""}
                      </p>
                    </div>
                    {isStatus && a.status && (
                      <StatusBadge status={a.status} size="xs" />
                    )}
                  </div>
                  {/* Quick intervention */}
                  {wo && (
                    <div className="mt-2.5 flex gap-2">
                      {isApproval ? (
                        <button
                          onClick={() => doAction(wo.id, "acknowledge")}
                          disabled={busy !== null}
                          className="h-8 px-3 rounded-lg bg-amber-500 text-[#111] text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <BadgeCheck className="h-3 w-3" /> Acknowledge
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setReassignFor(wo)}
                            className="h-8 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold flex items-center gap-1.5 hover:bg-accent transition-colors"
                          >
                            <ArrowRightLeft className="h-3 w-3" /> Reassign
                          </button>
                          <button
                            onClick={() => { setExtendFor(wo); setNewDue(""); }}
                            className="h-8 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold flex items-center gap-1.5 hover:bg-accent transition-colors"
                          >
                            <CalendarClock className="h-3 w-3" /> Extend
                          </button>
                        </>
                      )}
                      <button onClick={onGoWork} className="h-8 px-3 rounded-lg text-[11px] font-semibold text-primary flex items-center gap-1.5 hover:underline">
                        Open <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Open downtimes */}
      {data.downtimes.length > 0 && (
        <section>
          <h2 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Timer className="h-4 w-4 text-red-400" /> Machines down now</h2>
          <div className="grid gap-2 md:grid-cols-2 md:items-start">
            {data.downtimes.map((d) => (
              <div key={d.id} className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-bold">{d.machineCode} {d.machineName}</p>
                  <span className="text-[10px] font-mono text-red-400">DOWN since {fmtTime(d.startedAt)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{d.reason}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => closeDowntime(d.id)}
                    disabled={busy === d.id}
                    className="h-8 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    Mark back online
                  </button>
                  <button onClick={onGoMachines} className="h-8 px-3 rounded-lg text-[11px] font-semibold text-primary hover:underline">View machine</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Spares */}
      {stockAlerts.length > 0 && (
        <section>
          <h2 className="text-sm font-bold mb-2 flex items-center gap-1.5"><PackageX className="h-4 w-4 text-fuchsia-400" /> Spares running dry</h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {data.parts.filter((p) => p.stock <= p.reorderLevel).map((p) => (
              <div key={p.id} className="px-3 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold">{p.code} · {p.name}</p>
                  <p className="text-[10px] text-muted-foreground">reorder at {p.reorderLevel}</p>
                </div>
                <span className={`text-xs font-bold ${p.stock === 0 ? "text-red-400" : "text-amber-400"}`}>{p.stock} in store</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Live activity */}
      <section>
        <h2 className="text-sm font-bold mb-2">Live from the floor</h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {data.recentActivity.slice(0, 10).map((a) => (
            <div key={a.id} className="px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">
                  <span className="font-mono text-[10px] text-primary mr-1">{a.machineCode}</span>
                  {a.componentName}
                </p>
                {a.note && <p className="text-[10px] text-muted-foreground truncate">{a.note}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={a.status} size="xs" />
                <span className="text-[9px] text-muted-foreground w-12 text-right">{timeAgo(a.createdAt)}</span>
              </div>
            </div>
          ))}
          {data.recentActivity.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No reports yet today.</p>
          )}
        </div>
      </section>

      {/* Reassign sheet */}
      {reassignFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setReassignFor(null)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold">Reassign {reassignFor.code}</p>
            <p className="text-xs text-muted-foreground">{reassignFor.title} · {reassignFor.machineCode}</p>
            <div className="space-y-1.5">
              {data.artisans.map((a) => (
                <button
                  key={a.id}
                  onClick={() => doAction(reassignFor.id, "reassign", { assignedToId: a.id })}
                  disabled={busy !== null}
                  className="w-full h-11 rounded-xl bg-secondary border border-border px-3 flex items-center justify-between text-sm hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <span className="font-medium">{a.name}</span>
                  <span className="text-[10px] text-muted-foreground">{a.trade ?? "Artisan"} · {a.shift ? `Shift ${a.shift}` : "No shift"}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setReassignFor(null)} className="w-full h-10 rounded-xl text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {/* Extend sheet */}
      {extendFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setExtendFor(null)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold">Extend deadline · {extendFor.code}</p>
            <p className="text-xs text-muted-foreground">{extendFor.title}</p>
            <input
              type="datetime-local"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={() => newDue && doAction(extendFor.id, "extend", { dueDate: new Date(newDue).toISOString() })}
              disabled={!newDue || busy !== null}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Wrench className="h-4 w-4" /> Save new deadline
            </button>
            <button onClick={() => setExtendFor(null)} className="w-full h-10 rounded-xl text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {/* Quick-fix sheet — dispatch an urgent corrective WO from an escalation */}
      {quickFixFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setQuickFixFor(null)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[88vh] overflow-y-auto brewops-scroll" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Quick fix · {quickFixFor.machineCode}{quickFixFor.componentName ? ` · ${quickFixFor.componentName}` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground rounded-lg bg-secondary/60 p-2.5 leading-relaxed">
              <b className="text-foreground">{quickFixFor.raisedByName}</b> ({ESCALATION_META[quickFixFor.category].label}): {quickFixFor.message}
            </p>
            {quickFixFor.category === "NEEDS_SPARES" && partInfoFor(quickFixFor) && (
              <p className={`text-[11px] font-bold rounded-lg border px-2.5 py-1.5 ${partInfoFor(quickFixFor)!.stock === 0 ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"}`}>
                {partInfoFor(quickFixFor)!.code} · {partInfoFor(quickFixFor)!.stock === 0 ? "OUT OF STOCK, procure before dispatch" : `${partInfoFor(quickFixFor)!.stock} in store`}
              </p>
            )}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</p>
              <div className="flex gap-1.5">
                {["NORMAL", "HIGH", "URGENT"].map((p) => (
                  <button key={p} onClick={() => setQfPriority(p)}
                    className={`flex-1 h-9 rounded-lg border text-[11px] font-bold transition-colors ${qfPriority === p ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due within</p>
              <div className="flex gap-1.5">
                {[{ h: 4, l: "4 h" }, { h: 8, l: "8 h" }, { h: 24, l: "24 h" }, { h: 72, l: "3 d" }].map((o) => (
                  <button key={o.h} onClick={() => setQfDueHours(o.h)}
                    className={`flex-1 h-9 rounded-lg border text-[11px] font-bold transition-colors ${qfDueHours === o.h ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"}`}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Send to artisan</label>
              <select value={qfAssignee} onChange={(e) => setQfAssignee(e.target.value)} className="w-full h-11 rounded-xl bg-background border border-input px-2 text-sm outline-none mt-1">
                <option value="">Dispatch unassigned (pick up on the floor)</option>
                {data.artisans.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.trade ? ` · ${a.trade}` : ""}{a.shift ? ` · Shift ${a.shift}` : ""}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => escAction(quickFixFor.id, "dispatch", { priority: qfPriority, dueHours: qfDueHours, assignedToId: qfAssignee || null })}
              disabled={busy !== null}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" /> Dispatch corrective job now
            </button>
            <button onClick={() => setQuickFixFor(null)} className="w-full h-10 rounded-xl text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {/* Reroute sheet — hand the escalation's linked job to another artisan */}
      {rerouteEscFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setRerouteEscFor(null)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[88vh] overflow-y-auto brewops-scroll" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-primary" /> Reroute {rerouteEscFor.workOrderCode}
            </p>
            <p className="text-xs text-muted-foreground">
              {rerouteEscFor.machineCode} · raised by {rerouteEscFor.raisedByName}. Pick who takes over. They re-accept and check in on site.
            </p>
            <div className="space-y-1.5">
              {data.artisans
                .filter((a) => a.id !== data.workOrders.find((w) => w.id === rerouteEscFor.workOrderId)?.assignedToId)
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => escAction(rerouteEscFor.id, "reroute", { assignedToId: a.id })}
                    disabled={busy !== null}
                    className="w-full h-11 rounded-xl bg-secondary border border-border px-3 flex items-center justify-between text-sm hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="text-[10px] text-muted-foreground">{a.trade ?? "Artisan"} · {a.shift ? `Shift ${a.shift}` : "No shift"}</span>
                  </button>
                ))}
            </div>
            <button onClick={() => setRerouteEscFor(null)} className="w-full h-10 rounded-xl text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {/* Resolve sheet — close the loop with a note back to the artisan */}
      {resolveFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setResolveFor(null)}>
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold flex items-center gap-2">
              <CheckCheck className="h-4 w-4 text-emerald-400" /> Resolve · {resolveFor.machineCode}
            </p>
            <p className="text-[11px] text-muted-foreground rounded-lg bg-secondary/60 p-2.5 leading-relaxed">{resolveFor.raisedByName}: {resolveFor.message}</p>
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              rows={3}
              placeholder="What was done, e.g. Seal kit issued from store, job re-dispatched to Bello."
              className="w-full rounded-xl bg-background border border-input px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/50 resize-none leading-relaxed"
            />
            <button
              onClick={() => escAction(resolveFor.id, "resolve", { response: resolveNote.trim() })}
              disabled={!resolveNote.trim() || busy !== null}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <CheckCheck className="h-4 w-4" /> Close the loop
            </button>
            <button onClick={() => setResolveFor(null)} className="w-full h-10 rounded-xl text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

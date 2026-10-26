"use client";

import { useState } from "react";
import type { BootstrapData, WorkOrderDTO } from "@/lib/types";
import { ESCALATION_META } from "@/lib/types";
import { StatusBadge } from "@/components/brewops/status-badge";
import { STATUS_META, fmtTime, timeAgo, tradeMeta } from "@/lib/status";
import { woAction } from "@/lib/client-api";
import { toast } from "sonner";
import {
  ChevronRight, ClipboardList, Radar, AlertTriangle, CheckCircle2, Gauge, Clock, Megaphone,
  Hourglass, Send, TrendingUp, ShieldCheck, ListTree,
} from "lucide-react";

export default function ArtisanHome({
  data, onGoRound, onGoWork, onGoTrends, onGoProfile, onGoRegister,
}: {
  data: BootstrapData;
  onGoRound: () => void;
  onGoWork: () => void;
  onGoTrends: () => void;
  onGoProfile: () => void;
  onGoRegister: () => void;
}) {
  const [nudging, setNudging] = useState<string | null>(null);
  const myComps = data.machines.flatMap((m) => m.components);
  const reported = myComps.filter((c) => c.reportedToday).length;
  const total = myComps.length;
  const pct = total ? Math.round((reported / total) * 100) : 0;
  const roundDone = total > 0 && reported === total;

  const openWos = data.workOrders.filter((w) => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(w.status));
  const overdue = openWos.filter((w) => new Date(w.dueDate).getTime() < Date.now());
  const attention = myComps.filter((c) => STATUS_META[c.currentStatus].alert);

  // Approval follow-up loop — submitted work the Engineer has not acknowledged yet
  const awaitingApproval = data.workOrders
    .filter((w) => w.status === "COMPLETED" && !w.acknowledgedAt)
    .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime());

  const myEscs = data.escalations;
  const escOpenCount = myEscs.filter((e) => e.status !== "RESOLVED").length;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const sendFollowUp = async (w: WorkOrderDTO) => {
    setNudging(w.id);
    try {
      await woAction(w.id, { action: "nudge" });
      toast.success(`Follow-up sent to the Engineer · ${w.code}`, {
        description: "Your submission stays on their dashboard until it is acknowledged.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Follow-up failed");
    } finally {
      setNudging(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Greeting */}
      <section>
        <p className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="text-xl font-bold tracking-tight">{greet}, {data.user.name.split(" ")[0]} 👋</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {tradeMeta(data.user.trade)?.label ?? (data.user.trade ? data.user.trade.replace(/_/g, " ") : "Artisan")}
          {data.user.shift ? ` · Shift ${data.user.shift}` : ""} · {data.machines.length} machine{data.machines.length === 1 ? "" : "s"} on the plant registry
        </p>
      </section>

      {/* Awaiting the Engineer's approval — the follow-up loop for closure rate */}
      {awaitingApproval.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <Hourglass className="h-4 w-4 text-amber-400" /> Awaiting the Engineer&apos;s approval
            </h2>
            <span className="rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 px-2 py-0.5 text-[9px] font-bold">
              {awaitingApproval.length} submitted
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground mb-3">
            You signed these off. They stay here until the Engineer acknowledges them. Follow up to keep the closure rate moving.
          </p>
          <div className="space-y-2">
            {awaitingApproval.slice(0, 5).map((w) => (
              <div key={w.id} className="rounded-xl border border-amber-500/25 bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold truncate">{w.title}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">done {w.completedAt ? timeAgo(w.completedAt) : ""}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{w.machineCode} · {w.code} · {w.type === "PM" ? "Preventive" : "Corrective"}</p>
                <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    {w.verification === "FLAGGED"
                      ? <><AlertTriangle className="h-3 w-3 text-red-400" /> evidence under review</>
                      : <><CheckCircle2 className="h-3 w-3 text-emerald-400" /> submitted, not yet approved</>}
                    {w.followUpCount > 0 && <span className="font-bold text-amber-400">· followed up {w.followUpCount}×</span>}
                  </span>
                  <button
                    onClick={() => sendFollowUp(w)}
                    disabled={nudging === w.id}
                    className="h-8 px-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-bold flex items-center gap-1.5 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                  >
                    <Send className="h-3 w-3" /> Follow up with the Engineer
                  </button>
                </div>
              </div>
            ))}
            {awaitingApproval.length > 5 && (
              <button onClick={onGoWork} className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                and {awaitingApproval.length - 5} more in your Work tab
              </button>
            )}
          </div>
        </section>
      )}

      {/* Round progress */}
      <section className={`rounded-2xl border p-4 ${roundDone ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-card"}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Radar className={`h-4 w-4 ${roundDone ? "text-emerald-400" : "text-primary"}`} />
            <h2 className="text-sm font-bold">Today&apos;s Status Round</h2>
          </div>
          {roundDone ? (
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> COMPLETE</span>
          ) : (
            <span className="text-[11px] font-semibold text-muted-foreground">{reported}/{total} components</span>
          )}
        </div>
        <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${roundDone ? "bg-emerald-500" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {roundDone ? (
          <p className="text-[11px] text-emerald-300/80 mt-2.5">
            The report assembled itself as you walked. Your Engineer already sees it live.
          </p>
        ) : (
          <button
            onClick={onGoRound}
            className="mt-3 w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Radar className="h-4 w-4" />
            {reported === 0 ? "Start daily round" : "Continue round"}
          </button>
        )}
      </section>

      {/* Plant Status Register — the full report of every machine, valve, instrument and
          component across all departments, with its live status. One tap away. */}
      <button
        onClick={onGoRegister}
        className="w-full rounded-2xl border border-primary/30 bg-primary/5 p-4 text-left hover:bg-primary/10 transition-colors flex items-center gap-3"
      >
        <span className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
          <ListTree className="h-4.5 w-4.5 text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">Plant Status Register</span>
          <span className="block text-[10px] text-muted-foreground">
            Every machine, valve, instrument and component in all departments with its live status — tap any line to log it
          </span>
        </span>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{total} lines</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      {/* Quick stats — every card opens its own section */}
      <section className="grid grid-cols-3 gap-2.5 md:gap-3">
        <button onClick={onGoWork} className="rounded-xl border border-border bg-card p-3 md:p-4 text-left hover:bg-accent/50 transition-colors">
          <ClipboardList className="h-4 w-4 text-primary mb-1.5" />
          <p className="text-lg md:text-xl font-bold leading-none">{openWos.length}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">Open work orders</p>
        </button>
        <button onClick={onGoWork} className={`rounded-xl border p-3 md:p-4 text-left transition-colors ${overdue.length ? "border-red-500/40 bg-red-500/10 hover:bg-red-500/15" : "border-border bg-card hover:bg-accent/50"}`}>
          <AlertTriangle className={`h-4 w-4 mb-1.5 ${overdue.length ? "text-red-400" : "text-muted-foreground"}`} />
          <p className={`text-lg md:text-xl font-bold leading-none ${overdue.length ? "text-red-400" : ""}`}>{overdue.length}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">Overdue</p>
        </button>
        <button onClick={onGoTrends} className="rounded-xl border border-border bg-card p-3 md:p-4 text-left hover:bg-accent/50 transition-colors">
          <Gauge className="h-4 w-4 text-primary mb-1.5" />
          <p className="text-lg md:text-xl font-bold leading-none">{data.stats.completionRate7d}%</p>
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">7-day completion</p>
        </button>
      </section>

      {/* Closure rate — the artisan's approval scoreboard */}
      <button
        onClick={onGoWork}
        className="w-full rounded-2xl border border-border bg-card p-4 text-left hover:bg-accent/40 transition-colors flex items-center gap-3"
      >
        <span className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <ShieldCheck className="h-4.5 w-4.5 text-emerald-400" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">Closure rate · Engineer approvals</span>
          <span className="block text-[10px] text-muted-foreground">
            {data.stats.closureRate === null
              ? "No completed work in the last 30 days yet"
              : `${data.stats.closureRate}% of your completed work (30 days) is acknowledged · ${data.stats.pendingApprovalCount} still waiting`}
          </span>
        </span>
        <span className="text-lg font-bold text-emerald-400 shrink-0">{data.stats.closureRate === null ? "–" : `${data.stats.closureRate}%`}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      {/* My raised issues — the Engineer's responses come back here (feedback loop) */}
      {myEscs.length > 0 && (
        <section>
          <h2 className="text-sm font-bold mb-2 flex items-center gap-1.5">
            <Megaphone className={`h-4 w-4 ${escOpenCount ? "text-amber-400" : "text-muted-foreground"}`} /> Your raised issues
            {escOpenCount > 0 && <span className="rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 px-2 py-0.5 text-[9px] font-bold">{escOpenCount} in play</span>}
          </h2>
          <div className="space-y-2">
            {myEscs.slice(0, 4).map((e) => (
              <div
                key={e.id}
                className={`rounded-xl border p-3 ${
                  e.status === "OPEN" ? "border-amber-500/40 bg-amber-500/5"
                  : e.status === "ACK" ? "border-cyan-500/30 bg-cyan-500/5"
                  : "border-emerald-500/30 bg-emerald-500/5"}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[12px] font-bold flex items-center gap-1.5">
                    {ESCALATION_META[e.category].label}
                    <span className="font-normal text-muted-foreground">· {e.machineCode}{e.componentName ? ` ${e.componentName}` : ""}</span>
                  </p>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                    e.status === "OPEN" ? "border-amber-500/40 text-amber-300 bg-amber-500/10"
                    : e.status === "ACK" ? "border-cyan-500/40 text-cyan-300 bg-cyan-500/10"
                    : "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"}`}>
                    {e.status === "OPEN" ? "ENGINEER REVIEWING" : e.status === "ACK" ? "ENGINEER ACTING" : "RESOLVED"}
                  </span>
                </div>
                {e.response && (
                  <p className="text-[11px] text-cyan-300 mt-1.5 leading-relaxed">
                    Engineer{e.handledByName ? ` (${e.handledByName})` : ""}: {e.response}
                  </p>
                )}
                {e.reroutedToName && e.reroutedToName !== data.user.name && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Job handed over to {e.reroutedToName}</p>
                )}
                <p className="text-[9px] text-muted-foreground mt-1">raised {timeAgo(e.createdAt)}{e.workOrderCode ? ` · ${e.workOrderCode}` : ""}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Attention + Up next — side by side on desktop */}
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
      {attention.length > 0 && (
        <section className="min-w-0">
          <h2 className="text-sm font-bold mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Needs attention
          </h2>
          <div className="space-y-2">
            {attention.map((c) => {
              const machine = data.machines.find((m) => m.id === c.machineId);
              return (
                <button key={c.id} onClick={onGoRound} className="w-full rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-2 hover:bg-accent/50 transition-colors text-left">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{machine?.code} {machine?.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.currentStatus} size="xs" />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Next up — first 3 open WOs */}
      {openWos.length > 0 && (
        <section className="min-w-0">
          <h2 className="text-sm font-bold mb-2">Up next</h2>
          <div className="space-y-2">
            {openWos.slice(0, 3).map((w) => {
              const isOverdue = new Date(w.dueDate).getTime() < Date.now();
              const done = w.steps.filter((s) => s.doneAt).length;
              return (
                <button key={w.id} onClick={onGoWork} className="w-full rounded-xl border border-border bg-card p-3 text-left hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold truncate">{w.title}</p>
                    <span className={`text-[10px] font-bold shrink-0 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
                      {isOverdue ? "OVERDUE" : `Due ${new Date(w.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{w.machineCode} · {w.code} · {w.type === "PM" ? "Preventive" : "Corrective"}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${w.steps.length ? (done / w.steps.length) * 100 : 0}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
      </div>

      {/* Recent activity */}
      <section>
        <h2 className="text-sm font-bold mb-2">Your recent reports</h2>
        {data.recentActivity.length === 0 ? (
          <p className="text-xs text-muted-foreground rounded-xl border border-border bg-card p-4 text-center">
            Nothing yet. Your timestamped history starts with today&apos;s round.
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {data.recentActivity.slice(0, 8).map((a) => (
              <div key={a.id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{a.componentName}</p>
                  <p className="text-[10px] text-muted-foreground">{a.machineCode} · {a.note ? a.note : "no note"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={a.status} size="xs" />
                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{timeAgo(a.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
          <TrendingUp className="h-3 w-3" />
          Every report is stamped automatically{data.recentActivity[0] ? ` · last at ${fmtTime(data.recentActivity[0].createdAt)}` : ""}. Machine trends live in Trends.
        </p>
      </section>
    </div>
  );
}

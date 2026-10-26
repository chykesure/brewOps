"use client";

import { useMemo, useState } from "react";
import type { BootstrapData, PmTemplateDTO, PmOperationDTO } from "@/lib/types";
import { createWorkOrder, woAction, createTemplate, patchTemplate } from "@/lib/client-api";
import { WO_STATUS_META, PRIORITY_META, fmtDateTime, tradeMeta, FREQUENCY_CHIP, VERIFICATION_META, CHECKIN_METHOD_LABEL, fmtDistance } from "@/lib/status";
import { FREQUENCIES, FREQUENCY_META, type PmFrequency, type Trade } from "@/lib/types";
import WoReportDocument from "@/components/brewops/wo-report-document";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Search, Plus, LoaderCircle, Signature,
  CheckCircle2, Circle, ArrowRightLeft, CalendarClock, Wrench, XCircle,
  FileStack, ClipboardList, Zap, Power, Trash2, PencilLine, MessageSquarePlus, FileText,
  ShieldAlert, ShieldCheck, ShieldQuestion, MapPin, Camera, Gavel, BadgeCheck, Hourglass,
} from "lucide-react";

const PM_STEPS = [
  "Visual inspection: leaks, unusual noise, vibration",
  "Check & record operating parameters",
  "Check lubrication level & condition",
  "Inspect seals, couplings & fasteners",
  "Verify guards & safety devices in place",
  "Test run & confirm normal operation",
];
const CORRECTIVE_STEPS = ["Diagnose fault & isolate safely", "Repair / replace component", "Test run & verify fix", "Report findings in notes"];

interface OpDraft { subAssembly: string; trade: Trade; tasks: string }

const emptyOp = (): OpDraft => ({ subAssembly: "", trade: "MECHANICAL", tasks: "" });

export default function AdminWorkOrders({ data, refresh }: { data: BootstrapData; refresh: () => void }) {
  const [view, setView] = useState<"wos" | "plans">("wos");

  // ---- Work orders state ----
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "overdue" | "completed" | "flagged">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const [form, setForm] = useState({
    machineId: "", title: "", type: "PM", priority: "NORMAL", assignedToId: "",
    dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    steps: PM_STEPS.join("\n"), description: "",
  });

  // ---- PM plans state ----
  const [planOpenId, setPlanOpenId] = useState<string | null>(null); // template detail
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PmTemplateDTO | null>(null);
  const [planForm, setPlanForm] = useState({
    code: "", title: "", machineId: "", frequency: "MONTHLY" as PmFrequency,
    priority: "NORMAL", trade: "MECHANICAL" as Trade, durationMin: "", nextDueAt: "",
  });
  const [planOps, setPlanOps] = useState<OpDraft[]>([emptyOp()]);

  const wo = openId ? data.workOrders.find((w) => w.id === openId) : null;
  const [reportOpen, setReportOpen] = useState(false);
  const plan = planOpenId ? data.pmTemplates.find((t) => t.id === planOpenId) : null;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return data.workOrders.filter((w) => {
      const isOpen = ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(w.status);
      if (filter === "open" && !isOpen) return false;
      if (filter === "completed" && w.status !== "COMPLETED") return false;
      if (filter === "overdue" && !(isOpen && new Date(w.dueDate).getTime() < now)) return false;
      if (filter === "flagged" && w.verification !== "FLAGGED") return false;
      if (q && !`${w.code} ${w.title} ${w.machineCode} ${w.assignedToName ?? ""} ${w.templateCode ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.workOrders, query, filter]);

  const plans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.pmTemplates.filter((t) =>
      !q || `${t.code} ${t.title} ${t.machineCode} ${t.machineName}`.toLowerCase().includes(q)
    );
  }, [data.pmTemplates, query]);

  const create = async () => {
    if (!form.machineId || !form.title.trim() || !form.dueDate) {
      toast.error("Machine, title and due date are required.");
      return;
    }
    setBusy("create");
    try {
      const res = await createWorkOrder({
        machineId: form.machineId,
        title: form.title,
        type: form.type,
        priority: form.priority,
        assignedToId: form.assignedToId || undefined,
        dueDate: new Date(form.dueDate).toISOString(),
        steps: form.steps.split("\n").map((s) => s.trim()).filter(Boolean),
        description: form.description || undefined,
      });
      toast.success(`${res.code} created & pushed to dashboard`);
      setCreateOpen(false);
      setForm({ ...form, machineId: "", title: "", description: "", assignedToId: "" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create work order");
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(id + action);
    try {
      await woAction(id, { action, ...extra });
      toast.success(
        action === "cancel" ? "Work order cancelled"
        : action === "reassign" ? "Reassigned"
        : action === "extend" ? "Deadline extended"
        : action === "comment" ? "Supervisor comment saved"
        : action === "acknowledge" ? "Execution acknowledged · the artisan sees it instantly"
        : "Done"
      );
      if (action === "cancel") setOpenId(null);
      if (action === "comment" || action === "acknowledge") setComment("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  // ---- PM plan builder ----
  const openBuilder = (t?: PmTemplateDTO) => {
    if (t) {
      setEditingTemplate(t);
      setPlanForm({
        code: t.code, title: t.title, machineId: t.machineId, frequency: t.frequency,
        priority: t.priority, trade: t.trade, durationMin: t.durationMin ? String(t.durationMin) : "",
        nextDueAt: new Date(t.nextDueAt).toISOString().slice(0, 16),
      });
      setPlanOps(t.operations.map((op: PmOperationDTO) => ({ subAssembly: op.subAssembly, trade: op.trade, tasks: op.tasks.join("\n") })));
    } else {
      setEditingTemplate(null);
      setPlanForm({ code: "", title: "", machineId: "", frequency: "MONTHLY", priority: "NORMAL", trade: "MECHANICAL", durationMin: "", nextDueAt: "" });
      setPlanOps([emptyOp()]);
    }
    setBuilderOpen(true);
  };

  const savePlan = async () => {
    if (!planForm.title.trim() || !planForm.machineId) {
      toast.error("Title and machine are required.");
      return;
    }
    const ops = planOps
      .map((o) => ({ subAssembly: o.subAssembly.trim(), trade: o.trade, tasks: o.tasks.split("\n").map((s) => s.trim()).filter(Boolean) }))
      .filter((o) => o.tasks.length > 0 || o.subAssembly);
    if (ops.length === 0) { toast.error("Add at least one operation with tasks."); return; }

    setBusy("plan");
    try {
      if (editingTemplate) {
        await patchTemplate(editingTemplate.id, {
          title: planForm.title, machineId: planForm.machineId, frequency: planForm.frequency,
          priority: planForm.priority, trade: planForm.trade,
          durationMin: planForm.durationMin ? Number(planForm.durationMin) : null,
          nextDueAt: planForm.nextDueAt ? new Date(planForm.nextDueAt).toISOString() : undefined,
          operations: ops,
        });
        toast.success(`${editingTemplate.code} updated`);
      } else {
        const res = await createTemplate({
          code: planForm.code || undefined, title: planForm.title, machineId: planForm.machineId,
          frequency: planForm.frequency, priority: planForm.priority, trade: planForm.trade,
          durationMin: planForm.durationMin ? Number(planForm.durationMin) : undefined,
          nextDueAt: planForm.nextDueAt ? new Date(planForm.nextDueAt).toISOString() : undefined,
          operations: ops,
        });
        toast.success(`Plan ${res.code} created · scheduler will fire it when due`);
      }
      setBuilderOpen(false);
      setEditingTemplate(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save PM plan");
    } finally {
      setBusy(null);
    }
  };

  const togglePlan = async (t: PmTemplateDTO) => {
    setBusy(t.id + "toggle");
    try {
      await patchTemplate(t.id, { active: !t.active });
      toast.success(t.active ? `${t.code} paused. No new orders will fire` : `${t.code} activated`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  // Segment switch shared by both list views
  const segmentSwitch = (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 border border-border p-1">
      {([["wos", "Work Orders", ClipboardList], ["plans", "PM Plans", FileStack]] as const).map(([id, label, Icon]) => (
        <button key={id} onClick={() => setView(id)}
          className={`h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          <Icon className="h-3.5 w-3.5" /> {label}
          {id === "plans" && data.pmTemplates.length > 0 && (
            <span className={`rounded-full px-1.5 text-[9px] font-bold ${view === "plans" ? "bg-primary-foreground/20" : "bg-secondary"}`}>{data.pmTemplates.length}</span>
          )}
        </button>
      ))}
    </div>
  );

  // ================= PM PLAN DETAIL =================
  if (plan) {
    const fm = FREQUENCY_META[plan.frequency];
    const tm = tradeMeta(plan.trade);
    return (
      <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
        <button onClick={() => setPlanOpenId(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> PM Plans
        </button>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-muted-foreground">Maint.Plan {plan.code}</span>
            <div className="flex items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${FREQUENCY_CHIP[plan.frequency]}`}>{fm.label}</span>
              {tm && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${tm.cls}`}>{tm.code} {tm.label}</span>}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_META[plan.priority].cls}`}>{PRIORITY_META[plan.priority].label}</span>
            </div>
          </div>
          <h1 className="text-base font-bold mt-1.5 leading-snug">{plan.title}</h1>
          <p className="text-[11px] text-muted-foreground mt-1">{plan.machineCode} {plan.machineName} · {plan.operations.length} operations · {plan.operations.reduce((n, o) => n + o.tasks.length, 0)} tasks</p>
          <div className="mt-3 text-[11px] grid grid-cols-2 gap-2 text-muted-foreground">
            <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Next due {fmtDateTime(plan.nextDueAt)}</span>
            <span className="flex items-center gap-1"><FileStack className="h-3 w-3" /> {plan.openCount} order(s) open now</span>
            {plan.lastRunAt && <span className="flex items-center gap-1 col-span-2">Last fired {fmtDateTime(plan.lastRunAt)}</span>}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => openBuilder(plan)} className="flex-1 h-10 rounded-xl bg-secondary border border-border text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-accent">
              <PencilLine className="h-3.5 w-3.5" /> Edit plan
            </button>
            <button onClick={() => togglePlan(plan)} disabled={busy !== null}
              className={`flex-1 h-10 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 ${plan.active ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"}`}>
              <Power className="h-3.5 w-3.5" /> {plan.active ? "Pause plan" : "Activate plan"}
            </button>
          </div>
        </div>

        {/* Operations — mirrors the paper WO operation blocks */}
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Operations</p>
        {plan.operations.map((op) => {
          const otm = tradeMeta(op.trade);
          return (
            <div key={op.id} className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="px-3.5 py-2.5 bg-secondary/50 border-b border-border flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold"><span className="font-mono text-primary mr-1.5">{String(op.idx).padStart(4, "0")}</span>{op.subAssembly}</p>
                {otm && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold shrink-0 ${otm.cls}`}>{otm.code}</span>}
              </div>
              <div className="divide-y divide-border/60">
                {op.tasks.map((task, i) => (
                  <p key={i} className="px-3.5 py-2 text-[12px] leading-snug flex gap-2">
                    <span className="text-muted-foreground font-mono text-[10px] mt-0.5">{String(i + 1).padStart(2, "0")}</span>{task}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ================= WO DETAIL =================
  if (wo) {
    const done = wo.steps.filter((s) => s.doneAt).length;
    const allDone = done === wo.steps.length && wo.steps.length > 0;
    const isOverdue = new Date(wo.dueDate).getTime() < Date.now() && !["COMPLETED", "CANCELLED"].includes(wo.status);
    const closed = ["COMPLETED", "CANCELLED"].includes(wo.status);
    const assigneeTrade = tradeMeta(wo.assignedToTrade);

    // Group steps into operations when generated from a plan
    const opGroups: { opIdx: number; opName: string; steps: typeof wo.steps }[] = [];
    if (wo.steps.some((s) => s.opIdx !== null)) {
      for (const s of wo.steps) {
        const key = s.opIdx ?? 0;
        let g = opGroups.find((x) => x.opIdx === key);
        if (!g) { g = { opIdx: key, opName: s.opName ?? "Operation", steps: [] }; opGroups.push(g); }
        g.steps.push(s);
      }
    }

    return (
      <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
        <button onClick={() => { setOpenId(null); setReportOpen(false); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All work orders
        </button>

        <div className={`rounded-2xl border p-4 ${isOverdue ? "border-red-500/40 bg-red-500/5" : "border-border bg-card"}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-muted-foreground">{wo.code}</span>
            <div className="flex items-center gap-1.5">
              {wo.source === "PM_PLAN" && wo.frequency && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${FREQUENCY_CHIP[wo.frequency]}`}>{FREQUENCY_META[wo.frequency].label} PM</span>
              )}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${WO_STATUS_META[wo.status].cls}`}>{WO_STATUS_META[wo.status].label}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_META[wo.priority].cls}`}>{PRIORITY_META[wo.priority].label}</span>
              {wo.verification === "FLAGGED" && (
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold bg-red-500/15 text-red-400 border-red-500/30">FLAGGED</span>
              )}
              {wo.verification === "VERIFIED" && (
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border-emerald-500/30">VERIFIED</span>
              )}
              {wo.verification === "OVERRIDE" && (
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border-cyan-500/30">OVERRIDE</span>
              )}
            </div>
          </div>
          <h1 className="text-base font-bold mt-1.5 leading-snug">{wo.title}</h1>
          <p className="text-[11px] text-muted-foreground mt-1">
            {wo.machineCode} {wo.machineName}
            {wo.templateCode && <> · Maint.Plan <span className="font-mono">{wo.templateCode}</span></>}
            {wo.source === "PM_PLAN" && " · fired from PM plan"}
            {!["PM_PLAN", "SCHEDULER"].includes(wo.source) && ` · created ${fmtDateTime(wo.createdAt)}`}
          </p>
          {wo.description && <p className="text-xs mt-2 rounded-lg bg-secondary/70 p-2.5 leading-relaxed">{wo.description}</p>}
          <div className="mt-3 text-[11px] text-muted-foreground grid grid-cols-2 gap-2">
            <span className="flex items-center gap-1"><CalendarClock className={`h-3 w-3 ${isOverdue ? "text-red-400" : ""}`} /> Due {fmtDateTime(wo.dueDate)}</span>
            <span className="flex items-center gap-1">
              <ArrowRightLeft className="h-3 w-3" /> {wo.assignedToName ?? "Unassigned"}
              {assigneeTrade && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ml-1 ${assigneeTrade.cls}`}>{assigneeTrade.code}</span>}
            </span>
            {wo.startedAt && <span className="flex items-center gap-1"><Wrench className="h-3 w-3" /> Started {fmtDateTime(wo.startedAt)}</span>}
            {wo.completedAt && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Done {fmtDateTime(wo.completedAt)}</span>}
          </div>
          <button
            onClick={() => setReportOpen(true)}
            className="mt-3 w-full h-10 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-primary/20 transition-colors"
          >
            <FileText className="h-4 w-4" /> View WO Report · printed form
          </button>
        </div>

        {/* ---- Evidence & Verification panel — proof the work happened at the machine ---- */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Evidence &amp; verification</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${(VERIFICATION_META[wo.verification] ?? VERIFICATION_META.PENDING).cls}`}>
              {(VERIFICATION_META[wo.verification] ?? VERIFICATION_META.PENDING).label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className={`h-3.5 w-3.5 ${wo.checkInAt ? "text-emerald-400" : "text-zinc-500"}`} />
              {wo.checkInAt
                ? <>{CHECKIN_METHOD_LABEL[wo.checkInMethod ?? "CODE"]}{wo.checkInDistanceM != null ? ` · ${fmtDistance(wo.checkInDistanceM)} from machine` : ""}</>
                : "No on-site check-in"}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Camera className={`h-3.5 w-3.5 ${wo.evidence.length > 0 ? "text-emerald-400" : "text-zinc-500"}`} />
              {wo.evidence.length > 0 ? `${wo.evidence.length} evidence photo${wo.evidence.length === 1 ? "" : "s"}` : "No photos attached"}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
              {wo.steps.filter((s) => s.distanceM != null).length}/{wo.steps.length} steps GPS-stamped
            </span>
            {wo.checkInAttempts > 1 && (
              <span className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" /> {wo.checkInAttempts} check-in attempts
              </span>
            )}
            {wo.verification === "OVERRIDE" && wo.overrideReason && (
              <span className="col-span-2 text-[11px] text-cyan-300">Override by {wo.overrideByName}: {wo.overrideReason}</span>
            )}
          </div>
          {wo.flagReasons.length > 0 && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5">
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Review flags</p>
              <ul className="mt-1 space-y-0.5">
                {wo.flagReasons.map((f, i) => <li key={i} className="text-[11px] text-red-300/90 leading-snug">· {f}</li>)}
              </ul>
            </div>
          )}
          {wo.checkInPhoto && (
            <div className="flex items-center gap-2.5">
              <img src={wo.checkInPhoto} alt="Machine at check-in" className="h-16 w-16 rounded-lg object-cover border border-border" />
              <span className="text-[10px] text-muted-foreground leading-snug">Photo taken at check-in<br />(live camera, stamped)</span>
            </div>
          )}
          {wo.evidence.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {wo.evidence.map((url) => (
                 
                <img key={url} src={url} alt="Work evidence" className="h-16 w-16 rounded-lg object-cover border border-border" />
              ))}
            </div>
          )}
          {wo.verification !== "OVERRIDE" && (wo.verification === "FLAGGED" || (wo.status === "COMPLETED" && wo.evidence.length === 0)) && (
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Override · accept this record as the Engineer</p>
              <div className="flex gap-2">
                <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason (e.g. verified with artisan on site, tag reader faulty)"
                  className="flex-1 h-10 rounded-xl bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
                <button
                  onClick={() => {
                    if (!overrideReason.trim()) { toast.error("An override reason is required."); return; }
                    act(wo.id, "override", { reason: overrideReason.trim() });
                    setOverrideReason("");
                  }}
                  disabled={busy !== null || !overrideReason.trim()}
                  className="h-10 px-3 rounded-xl bg-cyan-600/80 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-40"
                >
                  <Gavel className="h-3.5 w-3.5" /> Override
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Steps — flat checklist or grouped by operation (plan-generated) */}
        {opGroups.length > 0 ? (
          <div className="space-y-2">
            {opGroups.map((g) => (
              <div key={g.opIdx} className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-3.5 py-2.5 bg-secondary/50 border-b border-border">
                  <p className="text-[11px] font-bold"><span className="font-mono text-primary mr-1.5">{String(g.opIdx).padStart(4, "0")}</span>{g.opName}</p>
                </div>
                <div className="divide-y divide-border/60">
                  {g.steps.map((s, i) => (
                    <div key={s.id} className="px-3.5 py-3 flex items-center gap-3">
                      {s.doneAt ? <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" /> : <Circle className="h-5 w-5 text-muted-foreground shrink-0" />}
                      <div className="min-w-0">
                        <p className={`text-[13px] leading-snug ${s.doneAt ? "line-through text-muted-foreground" : ""}`}>{s.text}</p>
                        {s.doneAt && <p className="text-[10px] text-emerald-400/80 mt-0.5">✓ {fmtDateTime(s.doneAt)}</p>}
                      </div>
                      <span className="ml-auto font-mono text-[9px] text-muted-foreground shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {wo.steps.map((s, i) => (
              <div key={s.id} className="px-3.5 py-3 flex items-center gap-3">
                {s.doneAt ? <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" /> : <Circle className="h-5 w-5 text-muted-foreground shrink-0" />}
                <div className="min-w-0">
                  <p className={`text-[13px] leading-snug ${s.doneAt ? "line-through text-muted-foreground" : ""}`}>
                    <span className="font-mono text-[10px] text-primary mr-1.5">{String(i + 1).padStart(2, "0")}</span>{s.text}
                  </p>
                  {s.doneAt && <p className="text-[10px] text-emerald-400/80 mt-0.5">✓ {fmtDateTime(s.doneAt)}</p>}
                </div>
              </div>
            ))}
            <div className="px-3.5 py-2 flex items-center justify-between bg-secondary/40">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Progress</span>
              <span className="text-xs font-bold">{done}/{wo.steps.length}</span>
            </div>
          </div>
        )}

        {/* Executioner Feedback (artisan sign-off note) */}
        {wo.feedback && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Executioner feedback</p>
            <p className="text-xs leading-relaxed">{wo.feedback}</p>
          </div>
        )}

        {/* Approval loop — the artisan sees "awaiting approval" until this happens */}
        {wo.status === "COMPLETED" && !wo.acknowledgedAt && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1.5">Acknowledge execution · closes the artisan&apos;s follow-up</p>
            <p className="text-[11px] text-muted-foreground mb-2.5">
              {wo.assignedToName ?? "The artisan"} submitted this order{wo.completedAt ? ` on ${fmtDateTime(wo.completedAt)}` : ""}
              {wo.followUpCount > 0 && <> and has followed up <b className="text-amber-400">{wo.followUpCount}×</b></>}. Acknowledging tells them the Engineer has reviewed and accepted it.
            </p>
            <div className="flex gap-2">
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional review note (saved as supervisor comment)"
                className="flex-1 h-10 rounded-xl bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
              <button onClick={() => act(wo.id, "acknowledge", comment.trim() ? { comment: comment.trim() } : {})} disabled={busy !== null}
                className="h-10 px-4 rounded-xl bg-amber-500 text-[#111] text-xs font-bold flex items-center gap-1.5 disabled:opacity-40">
                <BadgeCheck className="h-3.5 w-3.5" /> Acknowledge
              </button>
            </div>
          </div>
        )}
        {wo.status === "COMPLETED" && wo.acknowledgedAt && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 flex items-center gap-2.5">
            <BadgeCheck className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
            <p className="text-[11.5px] text-emerald-300 leading-snug">
              <b>Acknowledged</b> by {wo.acknowledgedByName ?? "the Engineer"} on {fmtDateTime(wo.acknowledgedAt)}. The artisan has been credited in their closure rate.
            </p>
          </div>
        )}

        {/* Supervisor Comments */}
        {wo.supervisorComment && (
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 mb-1">Supervisor comments</p>
            <p className="text-xs leading-relaxed">{wo.supervisorComment}</p>
          </div>
        )}
        {wo.status === "COMPLETED" && !wo.supervisorComment && (
          <div className="rounded-2xl border border-border bg-card p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Supervisor comments · review the executed order</p>
            <div className="flex gap-2">
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Oil sample sent to lab, recheck in 2 weeks"
                className="flex-1 h-10 rounded-xl bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
              <button onClick={() => comment.trim() && act(wo.id, "comment", { comment })} disabled={busy !== null || !comment.trim()}
                className="h-10 px-3 rounded-xl bg-secondary border border-border text-xs font-bold flex items-center gap-1 disabled:opacity-40">
                <MessageSquarePlus className="h-3.5 w-3.5" /> Save
              </button>
            </div>
          </div>
        )}

        {!closed && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={wo.assignedToId ?? ""}
                onChange={(e) => act(wo.id, "reassign", { assignedToId: e.target.value || null })}
                disabled={busy !== null}
                className="h-11 rounded-xl bg-card border border-input px-2 text-xs outline-none"
              >
                <option value="">Reassign to…</option>
                {data.artisans.map((a) => <option key={a.id} value={a.id}>{a.name}{a.trade === "ELECTRICAL" ? " · ELE" : a.trade === "MECHANICAL" ? " · MECH" : ""}</option>)}
              </select>
              <input
                type="datetime-local"
                defaultValue={new Date(wo.dueDate).toISOString().slice(0, 16)}
                onBlur={(e) => e.target.value && new Date(e.target.value).getTime() !== new Date(wo.dueDate).getTime() && act(wo.id, "extend", { dueDate: new Date(e.target.value).toISOString() })}
                disabled={busy !== null}
                className="h-11 rounded-xl bg-card border border-input px-3 text-xs outline-none"
              />
            </div>
            <button
              onClick={() => act(wo.id, "cancel")}
              disabled={busy !== null}
              className="w-full h-10 rounded-xl border border-red-500/40 text-red-400 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel work order
            </button>
            {isOverdue && (
              <p className="text-[10px] text-red-400 text-center">This job has slipped past its deadline. The artisan&apos;s dashboard flags it too.</p>
            )}
          </div>
        )}

        {reportOpen && wo && (
          <WoReportDocument
            wo={wo}
            machine={data.machines.find((m) => m.id === wo.machineId) ?? null}
            templateOps={data.pmTemplates.find((t) => t.code === wo.templateCode)?.operations ?? null}
            org={data.org}
            onClose={() => setReportOpen(false)}
          />
        )}
      </div>
    );
  }

  // ================= PM PLANS LIST =================
  if (view === "plans") {
    return (
      <div className="p-4 md:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2"><FileStack className="h-5 w-5 text-primary" /> PM Plans</h1>
            <p className="text-xs text-muted-foreground">Your digitised paper templates. The scheduler fires them into work orders when due.</p>
          </div>
          <button
            onClick={() => openBuilder()}
            className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-transform shrink-0"
          >
            <Plus className="h-4 w-4" /> New Plan
          </button>
        </div>

        {/* Frequency summary strip */}
        {segmentSwitch}
        <div className="flex gap-1.5 flex-wrap">
          {FREQUENCIES.map((f) => {
            const n = data.pmTemplates.filter((t) => t.frequency === f && t.active).length;
            if (n === 0) return null;
            return (
              <span key={f} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${FREQUENCY_CHIP[f]}`}>
                {FREQUENCY_META[f].label} × {n}
              </span>
            );
          })}
        </div>

        <div className="grid gap-2.5 md:grid-cols-2 md:items-start">
          {plans.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-10 md:col-span-2">
              No PM plans yet. Tap <b>New Plan</b> to digitise your first paper template.
            </p>
          )}
          {plans.map((t) => {
            const fm = FREQUENCY_META[t.frequency];
            const tm = tradeMeta(t.trade);
            const dueSoon = new Date(t.nextDueAt).getTime() - Date.now() < 86400_000 * 2;
            const tasks = t.operations.reduce((n, o) => n + o.tasks.length, 0);
            return (
              <div key={t.id} className={`rounded-2xl border p-4 ${t.active ? "border-border bg-card" : "border-border bg-card/50 opacity-65"}`}>
                <button onClick={() => setPlanOpenId(t.id)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-bold truncate">{t.title}</p>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-[10px] font-mono text-muted-foreground">{t.code}</span>
                    <span className="text-[10px] text-muted-foreground">· {t.machineCode}</span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${FREQUENCY_CHIP[t.frequency]}`}>{fm.label}</span>
                    {tm && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${tm.cls}`}>{tm.code}</span>}
                    {t.priority !== "NORMAL" && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${PRIORITY_META[t.priority].cls}`}>{PRIORITY_META[t.priority].label}</span>}
                    {!t.active && <span className="rounded-full border border-zinc-500/30 bg-zinc-500/15 text-zinc-400 px-1.5 py-0.5 text-[9px] font-bold">PAUSED</span>}
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <span className="text-[10px] text-muted-foreground">{t.operations.length} ops · {tasks} tasks · {t.openCount} open</span>
                    <span className={`text-[10px] font-bold ${t.active ? (dueSoon ? "text-amber-400" : "text-muted-foreground") : "text-muted-foreground"}`}>
                      {t.active ? (dueSoon ? "Due soon " : "Next ") : "Paused "}{fmtDateTime(t.nextDueAt)}
                    </span>
                  </div>
                </button>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => openBuilder(t)} className="flex-1 h-9 rounded-xl bg-secondary border border-border text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-accent">
                    <PencilLine className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={() => togglePlan(t)} disabled={busy !== null}
                    className={`flex-1 h-9 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 ${t.active ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"}`}>
                    <Power className="h-3 w-3" /> {t.active ? "Pause" : "Activate"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Plan builder sheet (create / edit a digitised paper template) */}
        {builderOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setBuilderOpen(false)}>
            <div className="w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[90vh] overflow-y-auto brewops-scroll" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{editingTemplate ? `Edit plan ${editingTemplate.code}` : "New PM plan"}</p>
                <button onClick={() => setBuilderOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
              </div>
              <p className="text-[10px] text-muted-foreground">Digitise a paper WO template: give it a frequency and the numbered operations. The scheduler fires it into a work order each time it comes due.</p>

              <div className="grid grid-cols-2 gap-2">
                <select value={planForm.machineId} onChange={(e) => setPlanForm({ ...planForm, machineId: e.target.value })} className="h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                  <option value="">Machine…</option>
                  {data.machines.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
                </select>
                <input value={planForm.code} onChange={(e) => setPlanForm({ ...planForm, code: e.target.value.toUpperCase() })} disabled={!!editingTemplate}
                  placeholder="Plan ref (auto)" className="h-11 rounded-xl bg-background border border-input px-3 text-xs outline-none font-mono disabled:opacity-50" />
              </div>

              <input value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                placeholder="WO description (e.g. Mthly Reception Screw SF01 Mech Inspect)"
                className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />

              <div className="grid grid-cols-2 gap-2">
                <select value={planForm.frequency} onChange={(e) => setPlanForm({ ...planForm, frequency: e.target.value as PmFrequency })} className="h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_META[f].label}</option>)}
                </select>
                <select value={planForm.priority} onChange={(e) => setPlanForm({ ...planForm, priority: e.target.value })} className="h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                  {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trade</label>
                  <select value={planForm.trade} onChange={(e) => setPlanForm({ ...planForm, trade: e.target.value as Trade })} className="w-full h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                    <option value="MECHANICAL">Mechanical (B-MA)</option>
                    <option value="ELECTRICAL">Electrical (B-EA)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Duration</label>
                  <input value={planForm.durationMin} onChange={(e) => setPlanForm({ ...planForm, durationMin: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="min"
                    className="w-full h-11 rounded-xl bg-background border border-input px-3 text-xs outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next due</label>
                  <input type="datetime-local" value={planForm.nextDueAt} onChange={(e) => setPlanForm({ ...planForm, nextDueAt: e.target.value })}
                    className="w-full h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none" />
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Operations · one block per sub-assembly</label>
                  <button onClick={() => setPlanOps([...planOps, emptyOp()])} className="text-[11px] font-bold text-primary flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Add operation
                  </button>
                </div>
                {planOps.map((op, i) => (
                  <div key={i} className="rounded-xl border border-border bg-background/60 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-primary shrink-0">{String((i + 1) * 10).padStart(4, "0")}</span>
                      <input value={op.subAssembly} onChange={(e) => setPlanOps(planOps.map((o, j) => j === i ? { ...o, subAssembly: e.target.value.toUpperCase() } : o))}
                        placeholder="SUB-ASSEMBLY (e.g. GEAR BOX)"
                        className="flex-1 h-9 rounded-lg bg-background border border-input px-2.5 text-xs outline-none font-semibold tracking-wide" />
                      <select value={op.trade} onChange={(e) => setPlanOps(planOps.map((o, j) => j === i ? { ...o, trade: e.target.value as Trade } : o))}
                        className="h-9 rounded-lg bg-background border border-input px-1.5 text-[10px] outline-none shrink-0">
                        <option value="MECHANICAL">B-MA</option>
                        <option value="ELECTRICAL">B-EA</option>
                      </select>
                      {planOps.length > 1 && (
                        <button onClick={() => setPlanOps(planOps.filter((_, j) => j !== i))} className="h-9 w-9 rounded-lg border border-red-500/40 text-red-400 flex items-center justify-center shrink-0 hover:bg-red-500/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <textarea value={op.tasks} onChange={(e) => setPlanOps(planOps.map((o, j) => j === i ? { ...o, tasks: e.target.value } : o))}
                      rows={3} placeholder="Task instructions · one per line (the Operation Long Text on the paper form)"
                      className="w-full rounded-lg bg-background border border-input px-2.5 py-2 text-xs outline-none resize-none font-mono leading-relaxed" />
                  </div>
                ))}
              </div>

              <button onClick={savePlan} disabled={busy !== null} className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {busy === "plan" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
                {editingTemplate ? "Save plan changes" : "Create PM plan"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ================= WO LIST =================
  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Work Orders</h1>
          <p className="text-xs text-muted-foreground">Generate, assign & track: PMs and corrective jobs.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-transform"
        >
          <Plus className="h-4 w-4" /> New
        </button>
      </div>

      {/* Segment switch: Work Orders | PM Plans */}
      {segmentSwitch}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search code, machine, artisan…" className="w-full h-11 rounded-xl bg-card border border-input pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {([
          { id: "all", label: "All" },
          { id: "open", label: "Open" },
          { id: "overdue", label: "Overdue" },
          { id: "completed", label: "Completed" },
          { id: "flagged", label: `Flagged${data.workOrders.some((w) => w.verification === "FLAGGED") ? " !" : ""}` },
        ] as const).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${filter === f.id ? "bg-primary text-primary-foreground border-primary" : f.id === "flagged" && data.workOrders.some((w) => w.verification === "FLAGGED") ? "bg-card border-red-500/50 text-red-400" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 md:items-start">
        {list.length === 0 && <p className="text-xs text-muted-foreground text-center py-10">No work orders here.</p>}
        {list.map((w) => {
          const isOverdue = new Date(w.dueDate).getTime() < Date.now() && !["COMPLETED", "CANCELLED"].includes(w.status);
          const done = w.steps.filter((s) => s.doneAt).length;
          return (
            <button key={w.id} onClick={() => setOpenId(w.id)} className={`w-full rounded-2xl border p-4 text-left transition-colors hover:bg-accent/40 ${isOverdue ? "border-red-500/40 bg-red-500/5" : "border-border bg-card"}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold truncate">{w.title}</p>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-[10px] font-mono text-muted-foreground">{w.code}</span>
                <span className="text-[10px] text-muted-foreground">· {w.machineCode}</span>
                {w.source === "PM_PLAN" && w.frequency && (
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${FREQUENCY_CHIP[w.frequency]}`}>{FREQUENCY_META[w.frequency].short}</span>
                )}
                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${WO_STATUS_META[w.status].cls}`}>{WO_STATUS_META[w.status].label}</span>
                {w.priority !== "NORMAL" && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${PRIORITY_META[w.priority].cls}`}>{PRIORITY_META[w.priority].label}</span>}
                {w.verification === "FLAGGED" && (
                  <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold bg-red-500/15 text-red-400 border-red-500/30 flex items-center gap-0.5"><ShieldAlert className="h-2.5 w-2.5" /> FLAGGED</span>
                )}
                {w.verification === "VERIFIED" && w.status === "COMPLETED" && (
                  <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border-emerald-500/30 flex items-center gap-0.5"><ShieldCheck className="h-2.5 w-2.5" /> VERIFIED</span>
                )}
                {w.status === "COMPLETED" && !w.acknowledgedAt && (
                  <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/15 text-amber-400 border-amber-500/30 flex items-center gap-0.5">
                    <Hourglass className="h-2.5 w-2.5" /> AWAITING APPROVAL{w.followUpCount > 0 ? ` · ${w.followUpCount}×` : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-2.5">
                <span className="text-[10px] text-muted-foreground">{w.assignedToName ?? "Unassigned"} · {done}/{w.steps.length} steps</span>
                <span className={`text-[10px] font-bold ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
                  {isOverdue ? "OVERDUE" : `Due ${new Date(w.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Create sheet */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setCreateOpen(false)}>
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[88vh] overflow-y-auto brewops-scroll" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">New work order</p>
              <button onClick={() => setCreateOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })} className="h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                <option value="">Machine…</option>
                {data.machines.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
              </select>
              <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })} className="h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                <option value="">Assign to…</option>
                {data.artisans.map((a) => <option key={a.id} value={a.id}>{a.name}{a.trade === "ELECTRICAL" ? " · ELE" : a.trade === "MECHANICAL" ? " · MECH" : ""}</option>)}
              </select>
            </div>

            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. Pump seal replacement)" className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />

            <div className="grid grid-cols-2 gap-2">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, steps: (e.target.value === "PM" ? PM_STEPS : CORRECTIVE_STEPS).join("\n") })} className="h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                <option value="PM">Preventive (PM)</option>
                <option value="CORRECTIVE">Corrective</option>
              </select>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-11 rounded-xl bg-background border border-input px-2 text-xs outline-none">
                {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due</label>
              <input type="datetime-local" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
            </div>

            <textarea value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} rows={6} placeholder="Checklist steps · one per line" className="w-full rounded-xl bg-background border border-input px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono" />
            <p className="text-[10px] text-muted-foreground">One step per line. Artisans tap each step as they complete it, timestamped live. For repeating templates use <b>PM Plans</b> instead.</p>

            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Context / description (optional)" className="w-full rounded-xl bg-background border border-input px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/50 resize-none" />

            <button onClick={create} disabled={busy !== null} className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {busy === "create" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Signature className="h-4 w-4" />}
              Create & assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

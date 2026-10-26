"use client";

import { useMemo, useRef, useState } from "react";
import type { BootstrapData, WorkOrderDTO } from "@/lib/types";
import { woAction, uploadPhoto, createEscalation } from "@/lib/client-api";
import { getPosition } from "@/lib/client-geo";
import { WO_STATUS_META, PRIORITY_META, fmtDateTime, timeAgo, tradeMeta, FREQUENCY_CHIP, VERIFICATION_META, CHECKIN_METHOD_LABEL, fmtDistance } from "@/lib/status";
import { ESCALATION_META, ESCALATION_CATEGORIES, FREQUENCY_META, type EscalationCategory } from "@/lib/types";
import WoReportDocument from "@/components/brewops/wo-report-document";
import CheckinSheet from "@/components/brewops/checkin-sheet";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Search, CheckCircle2, Circle, LoaderCircle,
  Wrench, CalendarClock, UserRound, Signature, ShieldAlert, FileText,
  MapPin, Camera, ShieldCheck, ShieldQuestion, X, ScanLine, Megaphone,
} from "lucide-react";

export default function WorksView({ data, refresh }: { data: BootstrapData; refresh: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Raise-hand — escalation to the Engineer (feedback loop)
  const [escOpen, setEscOpen] = useState(false);
  const [escCat, setEscCat] = useState<EscalationCategory>("CANNOT_FIX");
  const [escMsg, setEscMsg] = useState("");
  const [escPhoto, setEscPhoto] = useState<string | null>(null);
  const [escBusy, setEscBusy] = useState(false);
  const escFileRef = useRef<HTMLInputElement>(null);

  const wo = openId ? data.workOrders.find((w) => w.id === openId) : null;
  const reportWo = reportOpen && openId ? data.workOrders.find((w) => w.id === openId) : null;
  const machine = wo ? data.machines.find((m) => m.id === wo.machineId) : null;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.workOrders.filter((w) => {
      const isOpen = ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(w.status);
      if (filter === "open" && !isOpen) return false;
      if (filter === "done" && isOpen) return false;
      if (q && !`${w.code} ${w.title} ${w.machineCode} ${w.machineName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.workOrders, query, filter]);

  const act = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setBusy(id + action);
    try {
      const res = await woAction<{ ok: boolean; flags?: string[] }>(id, { action, ...extra });
      if (action === "complete") {
        if (res?.flags?.length) {
          toast.warning("Signed off · flagged for Engineer review", { description: res.flags[0] });
        } else {
          toast.success("Signed off · audit record locked");
        }
        setEvidence([]);
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const addEvidencePhoto = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(f);
      setEvidence((prev) => (prev.includes(url) ? prev : [...prev, url].slice(0, 6)));
      toast.success("Evidence photo attached");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleStep = async (woId: string, stepId: string) => {
    const fix = await getPosition();
    await act(woId, "toggleStep", { stepId, ...(fix ? { lat: fix.lat, lng: fix.lng } : {}) });
  };

  const addEscPhoto = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(f);
      setEscPhoto(url);
      toast.success("Issue photo attached");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (escFileRef.current) escFileRef.current.value = "";
    }
  };

  const submitEscalation = async () => {
    if (!wo) return;
    if (!escMsg.trim()) { toast.error("Tell the Engineer what is wrong"); return; }
    setEscBusy(true);
    try {
      await createEscalation({
        machineId: wo.machineId, workOrderId: wo.id,
        category: escCat, message: escMsg.trim(), photo: escPhoto ?? undefined,
      });
      toast.success("Engineer notified", {
        description: escCat === "SAFETY"
          ? "Safety escalation · Andon raised on the Command Center now"
          : "Your report is on the Engineer dashboard with quick-fix actions",
      });
      setEscOpen(false);
      setEscMsg("");
      setEscPhoto(null);
      setEscCat("CANNOT_FIX");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setEscBusy(false);
    }
  };

  // ---------- WO detail ----------
  if (wo) {
    const done = wo.steps.filter((s) => s.doneAt).length;
    const allDone = done === wo.steps.length && wo.steps.length > 0;
    const isOverdue = new Date(wo.dueDate).getTime() < Date.now() && !["COMPLETED", "CANCELLED"].includes(wo.status);
    const closed = ["COMPLETED", "CANCELLED"].includes(wo.status);
    const myTrade = tradeMeta(data.user.trade);
    const verified = wo.verification === "VERIFIED" || wo.verification === "OVERRIDE";
    const vm = VERIFICATION_META[wo.verification] ?? VERIFICATION_META.PENDING;
    // Feedback loop — escalations raised on this very job
    const woEscs = data.escalations.filter((e) => e.workOrderId === wo.id);

    // Group steps into operations when the order was fired from a PM plan
    const opGroups: { opIdx: number; opName: string; steps: WorkOrderDTO["steps"] }[] = [];
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
        <button onClick={() => setOpenId(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
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
            </div>
          </div>
          <h1 className="text-base font-bold mt-1.5 leading-snug">{wo.title}</h1>
          <p className="text-[11px] text-muted-foreground mt-1">
            {wo.machineCode} {wo.machineName} · {wo.type === "PM" ? "Preventive maintenance" : "Corrective work"}
            {wo.templateCode && <> · Maint.Plan <span className="font-mono">{wo.templateCode}</span></>}
          </p>
          {wo.description && <p className="text-xs mt-2 rounded-lg bg-secondary/70 p-2.5 leading-relaxed">{wo.description}</p>}
          {wo.description?.includes("Safety") && (
            <p className="text-[10px] mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 px-2.5 py-1.5 flex items-start gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" /> PPE required. Follow all Lockout, Permit & Safety instructions before you start.
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><CalendarClock className={`h-3 w-3 ${isOverdue ? "text-red-400" : ""}`} /> Due {fmtDateTime(wo.dueDate)}{isOverdue ? " · OVERDUE" : ""}</span>
            <span className="flex items-center gap-1"><UserRound className="h-3 w-3" /> {wo.assignedToName ?? "Unassigned"}{myTrade && <> · {myTrade.code}</>}</span>
            {wo.startedAt && <span className="flex items-center gap-1"><Wrench className="h-3 w-3" /> Started {fmtDateTime(wo.startedAt)}</span>}
            {wo.completedAt && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Completed {fmtDateTime(wo.completedAt)}</span>}
          </div>
          <button
            onClick={() => setReportOpen(true)}
            className="mt-3 w-full h-10 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-primary/20 transition-colors"
          >
            <FileText className="h-4 w-4" /> View WO Report · printed form
          </button>
        </div>

        {/* ---- Raise hand — feedback to the Engineer, even before check-in ---- */}
        {!closed && (
          <button
            onClick={() => { setEscOpen(true); setEscMsg(""); setEscPhoto(null); }}
            className="w-full h-11 rounded-xl border border-amber-500/40 bg-amber-500/5 text-amber-300 text-xs font-bold flex items-center justify-center gap-2 hover:bg-amber-500/10 transition-colors"
          >
            <Megaphone className="h-4 w-4" /> Raise hand · report an issue to the Engineer
          </button>
        )}
        {woEscs.map((e) => (
          <div
            key={e.id}
            className={`rounded-xl border p-3 ${
              e.status === "OPEN" ? "border-amber-500/40 bg-amber-500/5"
              : e.status === "ACK" ? "border-cyan-500/30 bg-cyan-500/5"
              : "border-emerald-500/30 bg-emerald-500/5"}`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] font-bold flex items-center gap-1.5">
                <Megaphone className="h-3 w-3 shrink-0" /> {ESCALATION_META[e.category].label}
                {e.componentName && <span className="font-normal text-muted-foreground"> · {e.componentName}</span>}
              </p>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                e.status === "OPEN" ? "border-amber-500/40 text-amber-300 bg-amber-500/10"
                : e.status === "ACK" ? "border-cyan-500/40 text-cyan-300 bg-cyan-500/10"
                : "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"}`}>
                {e.status === "OPEN" ? "WAITING ON ENGINEER" : e.status === "ACK" ? "ENGINEER ACTING" : "RESOLVED"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{e.message}</p>
            {e.response && <p className="text-[11px] text-cyan-300 mt-1.5 font-medium">Engineer: {e.response}</p>}
            {e.reroutedToName && <p className="text-[10px] text-muted-foreground mt-0.5">Job rerouted to {e.reroutedToName}</p>}
          </div>
        ))}

        {/* ---- On-site check-in / evidence banner ---- */}
        {!closed && wo.verification === "PENDING" && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5">
            <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <ScanLine className="h-4 w-4" /> On-site check-in required
            </p>
            <p className="text-[11px] text-amber-200/80 mt-1 leading-relaxed">
              Walk to <b>{wo.machineCode} {wo.machineName}</b> and check in on site: one-tap GPS, or the number
              registered from the machine&apos;s metal nameplate. Nothing to scan or print.
              The checklist unlocks once the system can verify you are at the machine.
            </p>
            <button
              onClick={() => setCheckinOpen(true)}
              className="mt-2.5 w-full h-11 rounded-xl bg-amber-400 text-amber-950 text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <MapPin className="h-4 w-4" /> Check in at machine
            </button>
          </div>
        )}
        {!closed && wo.verification === "FLAGGED" && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3.5">
            <p className="text-xs font-bold text-red-400 flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4" /> Check-in flagged · {vm.label}
            </p>
            <ul className="mt-1 space-y-0.5">
              {wo.flagReasons.map((f, i) => <li key={i} className="text-[11px] text-red-300/90">· {f}</li>)}
            </ul>
            <button
              onClick={() => setCheckinOpen(true)}
              className="mt-2.5 w-full h-10 rounded-xl border border-red-500/50 text-red-300 text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-500/10"
            >
              <MapPin className="h-4 w-4" /> Try check-in again
            </button>
          </div>
        )}
        {(wo.checkInAt || wo.verification === "OVERRIDE") && (
          <div className={`rounded-2xl border p-3.5 ${wo.verification === "OVERRIDE" ? "border-cyan-500/30 bg-cyan-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
            {wo.verification === "OVERRIDE" ? (
              <>
                <p className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5"><ShieldQuestion className="h-3.5 w-3.5" /> Supervisor override · {wo.overrideByName}</p>
                {wo.overrideReason && <p className="text-[11px] text-cyan-200/80 mt-0.5">{wo.overrideReason}</p>}
              </>
            ) : (
              <p className="text-[11px] font-bold text-emerald-400 flex items-center flex-wrap gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                On-site check-in verified · {CHECKIN_METHOD_LABEL[wo.checkInMethod ?? "CODE"]}
                {wo.checkInDistanceM != null && <> · {fmtDistance(wo.checkInDistanceM)} from machine</>}
                {wo.checkInAt && <span className="font-normal text-emerald-300/80"> · {fmtDateTime(wo.checkInAt)}</span>}
              </p>
            )}
          </div>
        )}

        {/* Steps checklist — grouped by operation when fired from a PM plan */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{opGroups.length > 0 ? "Operations · tap each task as you complete it" : "Steps · tap each one as you complete it"}</p>
            <span className="text-[11px] font-bold">{done}/{wo.steps.length}</span>
          </div>
          {!closed && !verified && (
            <p className="text-[10px] text-amber-300/90 mb-1.5 flex items-center gap-1.5">
              <ScanLine className="h-3 w-3" /> Locked. Check in at the machine to work through these steps on site.
            </p>
          )}
          {opGroups.length > 0 ? (
            <div className="space-y-2">
              {opGroups.map((g) => (
                <div key={g.opIdx} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-secondary/50 border-b border-border flex items-center justify-between">
                    <p className="text-[11px] font-bold"><span className="font-mono text-primary mr-1.5">{String(g.opIdx).padStart(4, "0")}</span>{g.opName}</p>
                    <span className="text-[10px] font-bold text-muted-foreground">{g.steps.filter((s) => s.doneAt).length}/{g.steps.length}</span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {g.steps.map((s, i) => (
                      <button
                        key={s.id}
                        disabled={closed || (!verified && !s.doneAt)}
                        onClick={() => toggleStep(wo.id, s.id)}
                        className={`w-full px-3.5 py-3.5 flex items-center gap-3 text-left transition-colors ${closed || !verified ? "opacity-70" : "hover:bg-accent/40 active:bg-accent/60"}`}
                      >
                        {s.doneAt ? <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" /> : <Circle className="h-6 w-6 text-muted-foreground shrink-0" />}
                        <div className="min-w-0">
                          <p className={`text-[13px] leading-snug ${s.doneAt ? "line-through text-muted-foreground" : "font-medium"}`}>{s.text}</p>
                          {s.doneAt && (
                            <p className="text-[10px] text-emerald-400/80 mt-0.5">
                              ✓ {fmtDateTime(s.doneAt)} · {timeAgo(s.doneAt)}
                              {s.distanceM != null && <> · <MapPin className="inline h-2.5 w-2.5" /> {fmtDistance(s.distanceM)}</>}
                            </p>
                          )}
                        </div>
                        <span className="ml-auto font-mono text-[9px] text-muted-foreground shrink-0">{String(i + 1).padStart(2, "0")}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
              {wo.steps.map((s, i) => {
                return (
                  <button
                    key={s.id}
                    disabled={closed || (!verified && !s.doneAt)}
                    onClick={() => toggleStep(wo.id, s.id)}
                    className={`w-full px-3.5 py-3.5 flex items-center gap-3 text-left transition-colors ${closed || !verified ? "opacity-70" : "hover:bg-accent/40 active:bg-accent/60"}`}
                  >
                    {s.doneAt ? (
                      <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
                    ) : (
                      <Circle className="h-6 w-6 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className={`text-[13px] leading-snug ${s.doneAt ? "line-through text-muted-foreground" : "font-medium"}`}>
                        <span className="font-mono text-[10px] text-primary mr-1.5">{String(i + 1).padStart(2, "0")}</span>
                        {s.text}
                      </p>
                      {s.doneAt && (
                        <p className="text-[10px] text-emerald-400/80 mt-0.5">
                          ✓ {fmtDateTime(s.doneAt)} · {timeAgo(s.doneAt)}
                          {s.distanceM != null && <> · <MapPin className="inline h-2.5 w-2.5" /> {fmtDistance(s.distanceM)}</>}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Photo evidence — mandatory proof of work done */}
        {!closed && allDone && (
          <div className="rounded-2xl border border-border bg-card p-3.5 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Photo evidence · required before sign-off</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">Capture the work as done: gauge readings, the repaired part, oil level… The Engineer sees these on the signed record.</p>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addEvidencePhoto(e.target.files?.[0])} />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-11 px-4 rounded-xl border border-border bg-secondary flex items-center gap-2 text-xs font-medium hover:bg-accent disabled:opacity-60"
              >
                {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {evidence.length > 0 ? `Add photo (${evidence.length})` : "Take evidence photo"}
              </button>
              {evidence.map((url) => (
                <div key={url} className="relative">
                  { }
                  <img src={url} alt="Work evidence" className="h-11 w-11 rounded-lg object-cover border border-border" />
                  <button
                    onClick={() => setEvidence(evidence.filter((u) => u !== url))}
                    className="absolute -top-1.5 -right-1.5 h-4.5 w-4.5 h-[18px] w-[18px] rounded-full bg-red-500 text-white flex items-center justify-center"
                    aria-label="Remove photo"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Executioner Feedback — captured at sign-off (paper form footer) */}
        {!closed && allDone && (
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Executioner feedback · what did you find?</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="e.g. Functionality of level transmitter was checked. Ok. / Gearbox oil slightly cloudy, top-up done, monitor."
              className="w-full mt-1 rounded-xl bg-card border border-input px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/50 resize-none leading-relaxed"
            />
          </div>
        )}
        {wo.status === "COMPLETED" && wo.feedback && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Executioner feedback</p>
            <p className="text-xs leading-relaxed">{wo.feedback}</p>
          </div>
        )}
        {wo.status === "COMPLETED" && wo.supervisorComment && (
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 mb-1">Supervisor comments</p>
            <p className="text-xs leading-relaxed">{wo.supervisorComment}</p>
          </div>
        )}
        {wo.status === "COMPLETED" && wo.evidence.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Evidence photos attached to this record</p>
            <div className="flex gap-2 flex-wrap">
              {wo.evidence.map((url) => (
                 
                <img key={url} src={url} alt="Work evidence" className="h-16 w-16 rounded-lg object-cover border border-border" />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {!closed && (
          <div className="space-y-2">
            {wo.status === "PENDING" && (
              <button
                onClick={() => act(wo.id, "accept")}
                disabled={busy !== null}
                className="w-full h-12 rounded-xl bg-secondary border border-border text-sm font-bold flex items-center justify-center gap-2 hover:bg-accent transition-colors disabled:opacity-50"
              >
                {busy === wo.id + "accept" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                Accept job
              </button>
            )}
            {["PENDING", "ACCEPTED"].includes(wo.status) && (
              <button
                onClick={() => (verified ? act(wo.id, "start") : setCheckinOpen(true))}
                disabled={busy !== null}
                className={`w-full h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50 ${verified ? "bg-secondary border border-border hover:bg-accent" : "bg-amber-400 text-amber-950"}`}
              >
                <Wrench className="h-4 w-4" /> {verified ? "Start work" : "Check in at machine to start"}
              </button>
            )}
            <button
              onClick={() => act(wo.id, "complete", { feedback: feedback.trim() || null, evidence })}
              disabled={!allDone || busy !== null || (evidence.length === 0 && data.user.role !== "ADMIN")}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40"
            >
              {busy === wo.id + "complete" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Signature className="h-4 w-4" />}
              {!allDone
                ? `Complete all ${wo.steps.length} steps first`
                : evidence.length === 0
                  ? "Take an evidence photo to sign off"
                  : "Complete & sign"}
            </button>
            {!allDone && <p className="text-[10px] text-muted-foreground text-center">Completing stamps your name, GPS evidence and the exact time. Permanently.</p>}
          </div>
        )}
        {wo.status === "COMPLETED" && (
          <p className="text-xs text-emerald-400 text-center bg-emerald-500/10 border border-emerald-500/30 rounded-xl py-3">
            ✓ Signed off {fmtDateTime(wo.completedAt!)} · audit record is locked.
          </p>
        )}

        {/* Check-in sheet needs only the WO context — rerouted jobs target machines
            that may not be in the artisan's own round, so don't gate on the machine
            being present in the bootstrap payload. */}
        {wo && (
          <CheckinSheet
            woId={wo.id}
            woCode={wo.code}
            machineCode={wo.machineCode}
            machineName={wo.machineName}
            open={checkinOpen}
            onClose={() => setCheckinOpen(false)}
            onVerified={refresh}
          />
        )}

        {/* ---- Raise-hand sheet: artisan feedback → Engineer Command Center ---- */}
        {escOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setEscOpen(false)}>
            <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[88vh] overflow-y-auto brewops-scroll" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-amber-400" /> Raise hand · {wo.machineCode}
                </p>
                <button onClick={() => setEscOpen(false)} className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Stuck mid-job? Report it: your message lands on the Engineer&apos;s dashboard with this job ({wo.code}) and your name attached, with quick-fix and reroute actions ready.
              </p>
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">What kind of issue?</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {ESCALATION_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setEscCat(c)}
                      className={`h-10 rounded-xl border text-[11px] font-bold transition-colors ${
                        escCat === c
                          ? c === "SAFETY"
                            ? "border-red-500/60 bg-red-500/15 text-red-300"
                            : "border-primary/60 bg-primary/15 text-primary"
                          : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {ESCALATION_META[c].label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">{ESCALATION_META[escCat].hint}</p>
              </div>
              <textarea
                value={escMsg}
                onChange={(e) => setEscMsg(e.target.value)}
                rows={3}
                placeholder="Describe it, e.g. Bearing seal kit SK-12 not in store, pump cannot be reassembled."
                className="w-full rounded-xl bg-background border border-input px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/50 resize-none leading-relaxed"
              />
              <input ref={escFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addEscPhoto(e.target.files?.[0])} />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => escFileRef.current?.click()}
                  disabled={uploading}
                  className="h-10 px-3.5 rounded-xl border border-border bg-secondary flex items-center gap-2 text-[11px] font-semibold hover:bg-accent disabled:opacity-60"
                >
                  {uploading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                  {escPhoto ? "Photo attached" : "Add issue photo"}
                </button>
                {escPhoto && <img src={escPhoto} alt="Issue" className="h-10 w-10 rounded-lg object-cover border border-border" />}
              </div>
              <button
                onClick={submitEscalation}
                disabled={!escMsg.trim() || escBusy}
                className={`w-full h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40 ${
                  escCat === "SAFETY" ? "bg-red-500 text-white" : "bg-primary text-primary-foreground"
                }`}
              >
                {escBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                {escCat === "SAFETY" ? "Send · raise Andon now" : "Send to Engineer"}
              </button>
              <button onClick={() => setEscOpen(false)} className="w-full h-10 rounded-xl text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        )}

        {reportWo && (
          <WoReportDocument
            wo={reportWo}
            machine={data.machines.find((m) => m.id === reportWo.machineId) ?? null}
            templateOps={null}
            org={data.org}
            onClose={() => setReportOpen(false)}
          />
        )}
      </div>
    );
  }

  // ---------- WO list ----------
  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="text-lg font-bold tracking-tight">My Work</h1>
        <p className="text-xs text-muted-foreground">PMs pushed to you by the scheduler + corrective jobs from the Engineer.</p>
      </div>

      {reportWo && (
        <WoReportDocument
          wo={reportWo}
          machine={data.machines.find((m) => m.id === reportWo.machineId) ?? null}
          templateOps={null}
          org={data.org}
          onClose={() => setReportOpen(false)}
        />
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search work orders…"
          className="w-full h-11 rounded-xl bg-card border border-input pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="flex gap-2">
        {([
          { id: "open", label: "Open" },
          { id: "done", label: "Completed" },
        ] as const).map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${filter === f.id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 md:items-start">
        {list.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-10">
            {filter === "open" ? "All clear, nothing open. 🎉" : "Nothing completed yet."}
          </p>
        )}
        {list.map((w) => {
          const isOverdue = new Date(w.dueDate).getTime() < Date.now() && !["COMPLETED", "CANCELLED"].includes(w.status);
          const done = w.steps.filter((s) => s.doneAt).length;
          return (
            <button
              key={w.id}
              onClick={() => { setOpenId(w.id); setFeedback(""); setEvidence([]); }}
              className={`w-full rounded-2xl border p-4 text-left transition-colors hover:bg-accent/40 ${isOverdue || w.verification === "FLAGGED" ? "border-red-500/40 bg-red-500/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold truncate">{w.title}</p>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-[10px] font-mono text-muted-foreground">{w.code}</span>
                <span className="text-[10px] text-muted-foreground">· {w.machineCode} {w.machineName}</span>
                {w.source === "PM_PLAN" && w.frequency && (
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${FREQUENCY_CHIP[w.frequency]}`}>{FREQUENCY_META[w.frequency].short}</span>
                )}
                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${WO_STATUS_META[w.status].cls}`}>{WO_STATUS_META[w.status].label}</span>
                {w.priority !== "NORMAL" && (
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${PRIORITY_META[w.priority].cls}`}>{PRIORITY_META[w.priority].label}</span>
                )}
                {w.verification === "FLAGGED" && (
                  <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold bg-red-500/15 text-red-400 border-red-500/30 flex items-center gap-0.5">
                    <ShieldAlert className="h-2.5 w-2.5" /> FLAGGED
                  </span>
                )}
                {w.verification === "VERIFIED" && ["COMPLETED", "IN_PROGRESS"].includes(w.status) && (
                  <span className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border-emerald-500/30 flex items-center gap-0.5">
                    <ShieldCheck className="h-2.5 w-2.5" /> VERIFIED
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-2.5">
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden flex-1 mr-3">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${w.steps.length ? (done / w.steps.length) * 100 : 0}%` }} />
                </div>
                <span className={`text-[10px] font-bold shrink-0 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
                  {isOverdue ? "OVERDUE" : w.status === "COMPLETED" ? `Done ${fmtDateTime(w.completedAt!)}` : `Due ${new Date(w.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

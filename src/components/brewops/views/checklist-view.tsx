"use client";

// Weekly Checklist — the artisan's phone view of the digitised paper sheet.
// Start (auto-timer) → tick rows Done / Fault / Skipped / Re-check → Submit.
// Every tick is timestamped server-side, so actual-vs-planned time lands in
// the Engineer's efficiency ranking without anybody filling a timesheet.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BootstrapData, ChecklistArtisanData, ChecklistRunDTO, ChecklistRowStatus } from "@/lib/types";
import { CHECKLIST_ROW_STATUS_META } from "@/lib/types";
import { fetchChecklistsWeek, checklistStart, checklistTick, checklistSubmit, uploadPhoto } from "@/lib/client-api";
import { toast } from "sonner";
import {
  BadgeCheck, Camera, ChevronDown, ChevronUp, ClipboardCheck, Clock, FileText,
  LoaderCircle, PlayCircle, TriangleAlert, X,
} from "lucide-react";

const STATUS_CHIPS: { id: ChecklistRowStatus; label: string; cls: string; activeCls: string }[] = [
  { id: "DONE", label: "Done", cls: "border-emerald-500/40 text-emerald-400", activeCls: "bg-emerald-500 text-white border-emerald-500" },
  { id: "FAULT", label: "Fault", cls: "border-red-500/40 text-red-400", activeCls: "bg-red-500 text-white border-red-500" },
  { id: "SKIPPED", label: "Skip", cls: "border-zinc-500/40 text-zinc-400", activeCls: "bg-zinc-500 text-white border-zinc-500" },
  { id: "RECHECK", label: "Re-check", cls: "border-amber-500/40 text-amber-400", activeCls: "bg-amber-500 text-white border-amber-500" },
];

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - day);
  return x;
}

function fmtWeek(weekISO: string): string {
  const start = new Date(weekISO);
  const end = new Date(start.getTime() + 6 * 86400_000);
  const f = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${f(start)} – ${f(end)}`;
}

function fmtClock(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function fmtTick(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

type Override = { status: ChecklistRowStatus; note: string | null; photo: string | null; pending?: boolean };

export default function ChecklistView({ data }: { data: BootstrapData }) {
  const [weekData, setWeekData] = useState<ChecklistArtisanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [pendingFault, setPendingFault] = useState<string | null>(null); // row that tapped FAULT and still owes a note
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());
  const photoEntryRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const weekISO = useMemo(() => mondayOf(new Date()).toISOString(), []);

  const load = useCallback(async (keepOpen = false) => {
    try {
      const d = await fetchChecklistsWeek(weekISO);
      setWeekData(d);
      if (!keepOpen) setOpenRunId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the checklist");
    } finally {
      setLoading(false);
    }
  }, [weekISO]);

  useEffect(() => { void load(); }, [load]);

  // Live elapsed clock while a sheet is open in progress
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const runById = useCallback((id: string | null) => (id ? weekData?.runs.find((r) => r.id === id) ?? weekData?.history.find((r) => r.id === id) ?? null : null), [weekData]);
  const openRun = runById(openRunId);
  const openTemplate = openRun ? weekData?.templates.find((t) => t.id === openRun.templateId) ?? null : null;

  const eff = (e: { id: string; status: string; note: string | null; photo: string | null }): Override => {
    const o = overrides[e.id];
    return o ?? { status: e.status as ChecklistRowStatus, note: e.note, photo: e.photo };
  };

  const entryStatus = (e: { id: string; status: string; note: string | null; photo: string | null }): ChecklistRowStatus => eff(e).status;
  const liveCounts = (run: ChecklistRunDTO) => {
    const c = { done: 0, fault: 0, skipped: 0, recheck: 0, pending: 0, total: run.entries.length };
    for (const e of run.entries) {
      const s = entryStatus(e);
      if (s === "DONE") c.done++;
      else if (s === "FAULT") c.fault++;
      else if (s === "SKIPPED") c.skipped++;
      else if (s === "RECHECK") c.recheck++;
      else c.pending++;
    }
    return c;
  };

  const openSheet = (run: ChecklistRunDTO) => {
    setOverrides({});
    setNoteFor(null);
    setConfirmSubmit(false);
    setOpenRunId(run.id);
  };

  const start = async (templateId: string) => {
    setBusy(templateId);
    try {
      const res = await checklistStart(templateId, weekISO);
      await load(true);
      if (res.run) openSheet(res.run);
      toast.success("Sheet opened — the clock is running");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start";
      if (msg.includes("already submitted")) toast.info("This week's sheet is already submitted");
      else toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const saveTick = async (run: ChecklistRunDTO, entryId: string, status: ChecklistRowStatus, note?: string | null, photo?: string | null) => {
    const prev = overrides[entryId];
    setOverrides((m) => ({ ...m, [entryId]: { status, note: note ?? prev?.note ?? null, photo: photo ?? prev?.photo ?? null, pending: true } }));
    try {
      await checklistTick(run.id, entryId, status, note ?? prev?.note ?? undefined, photo ?? prev?.photo ?? undefined);
      setOverrides((m) => ({ ...m, [entryId]: { status, note: note ?? prev?.note ?? null, photo: photo ?? prev?.photo ?? null } }));
    } catch (e) {
      if (prev) setOverrides((m) => ({ ...m, [entryId]: prev })); else setOverrides((m) => { const { [entryId]: _drop, ...rest } = m; return rest; });
      toast.error(e instanceof Error ? e.message : "Could not save the tick");
    }
  };

  const onChip = (run: ChecklistRunDTO, e: ChecklistRunDTO["entries"][number], status: ChecklistRowStatus) => {
    const cur = eff(e);
    if (status === "FAULT" && !(cur.note ?? "").trim()) {
      setNoteFor(e.id);
      setPendingFault(e.id);
      toast.info("Describe the fault — the Engineer needs detail");
      return;
    }
    setPendingFault((pf) => (pf === e.id ? null : pf));
    if (status !== "PENDING" && cur.status === status) {
      // tapping the active chip again clears it back to pending
      void saveTick(run, e.id, "PENDING", cur.note);
      return;
    }
    void saveTick(run, e.id, status, cur.note);
  };

  const saveNote = (run: ChecklistRunDTO, e: ChecklistRunDTO["entries"][number]) => {
    const cur = eff(e);
    const note = (cur.note ?? "").trim();
    const owesFault = pendingFault === e.id;
    if (owesFault && !note) { toast.error("Describe the fault first"); return; }
    setNoteFor(null);
    if (owesFault && note) {
      setPendingFault(null);
      void saveTick(run, e.id, "FAULT", note);
      return;
    }
    if (cur.status === "PENDING" && note) {
      void saveTick(run, e.id, "RECHECK", note); // a written remark defaults to re-check
      return;
    }
    if (cur.status !== "PENDING") void saveTick(run, e.id, cur.status, note);
  };

  const addPhoto = async (run: ChecklistRunDTO, entryId: string, f: File | undefined) => {
    if (!f) return;
    setBusy(entryId + ":photo");
    try {
      const url = await uploadPhoto(f);
      const cur = overrides[entryId];
      await checklistTick(run.id, entryId, cur?.status ?? "PENDING", cur?.note ?? undefined, url);
      setOverrides((m) => ({ ...m, [entryId]: { status: cur?.status ?? "PENDING", note: cur?.note ?? null, photo: url } }));
      toast.success("Photo attached to the row");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
      photoEntryRef.current = null;
    }
  };

  const submit = async (run: ChecklistRunDTO) => {
    const counts = liveCounts(run);
    if (!confirmSubmit && counts.pending > 0) { setConfirmSubmit(true); return; }
    setBusy(run.id + ":submit");
    try {
      const planned = openTemplate?.totalPlannedMin ?? run.totalPlannedMin ?? 0;
      await checklistSubmit(run.id);
      toast.success(`Sheet submitted — ${fmtClock((Date.now() - new Date(run.startedAt).getTime()) / 60000)} actual vs ${fmtClock(planned)} planned`);
      setConfirmSubmit(false);
      setOpenRunId(null);
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Loading this week&apos;s sheets…
      </div>
    );
  }

  const myTrade = data.user.trade;
  const templates = weekData?.templates ?? [];

  return (
    <div className="px-4 py-4 space-y-4 max-w-md mx-auto">
      {/* Header */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold leading-tight">Weekly Checklist</h1>
            <p className="text-[11px] text-muted-foreground">{fmtWeek(weekISO)} · week of the paper inspection sheets</p>
          </div>
        </div>
        {myTrade && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Showing the <span className="font-semibold text-foreground">{myTrade === "ELECTRICAL" ? "Electrical" : "Mechanical"}</span> sheet for your trade.
          </p>
        )}
      </div>

      {/* This week's sheets */}
      {templates.length === 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-300">
          No checklist sheets are assigned to your trade yet. Ask the Engineer to add one (Checklists tab → Template).
        </div>
      )}

      {templates.map((t) => {
        const myRun = weekData?.runs.find((r) => r.templateId === t.id) ?? null;
        const counts = myRun ? liveCounts(myRun) : null;
        const elapsedMin = myRun ? (nowTs - new Date(myRun.startedAt).getTime()) / 60000 : 0;
        return (
          <div key={t.id} className="rounded-2xl border border-border bg-card/70 backdrop-blur overflow-hidden">
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold leading-snug">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t.rows.length} tasks · planned {fmtClock(t.totalPlannedMin)} · {t.trade === "ELECTRICAL" ? "Electrical" : "Mechanical"}
                  </p>
                </div>
                {!myRun && <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-300 text-[10px] font-bold px-2 py-1">Due this week</span>}
                {myRun?.status === "IN_PROGRESS" && <span className="shrink-0 rounded-full border border-sky-500/40 bg-sky-500/15 text-sky-300 text-[10px] font-bold px-2 py-1">In progress</span>}
                {myRun?.status === "SUBMITTED" && <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-300 text-[10px] font-bold px-2 py-1">Awaiting approval</span>}
                {myRun?.status === "ACKNOWLEDGED" && <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 text-[10px] font-bold px-2 py-1">Approved</span>}
              </div>

              {myRun && counts && (
                <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[15px] font-bold">{counts.done}<span className="text-muted-foreground text-[11px]">/{counts.total}</span></p>
                    <p className="text-[10px] text-muted-foreground">Done</p>
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-red-400">{counts.fault}</p>
                    <p className="text-[10px] text-muted-foreground">Faults</p>
                  </div>
                  <div>
                    <p className="text-[15px] font-bold">
                      {myRun.status === "IN_PROGRESS" ? fmtClock(elapsedMin) : fmtClock(myRun.totalActualMin ?? elapsedMin)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{myRun.status === "IN_PROGRESS" ? "Elapsed" : "Actual time"}</p>
                  </div>
                </div>
              )}

              {myRun?.status === "ACKNOWLEDGED" && myRun.ackByName && (
                <p className="mt-2 text-[11px] text-emerald-300 flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" /> Approved by {myRun.ackByName}{myRun.ackNote ? ` — “${myRun.ackNote}”` : ""}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {!myRun && (
                  <button
                    onClick={() => void start(t.id)}
                    disabled={busy === t.id}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-3.5 py-2 text-[12px] font-bold disabled:opacity-60"
                  >
                    {busy === t.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                    Start sheet · clock runs
                  </button>
                )}
                {myRun?.status === "IN_PROGRESS" && openRunId !== myRun.id && (
                  <button
                    onClick={() => openSheet(myRun)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-3.5 py-2 text-[12px] font-bold"
                  >
                    <PlayCircle className="h-4 w-4" /> Continue filling
                  </button>
                )}
                {myRun && openRunId !== myRun.id && myRun.status !== "IN_PROGRESS" && (
                  <button
                    onClick={() => openSheet(myRun)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-secondary/60 px-3.5 py-2 text-[12px] font-semibold"
                  >
                    <FileText className="h-4 w-4" /> View submitted sheet
                  </button>
                )}
              </div>
            </div>

            {/* ── The sheet itself ── */}
            {openRunId === myRun?.id && openRun && (
              <div className="border-t border-border">
                <div className="flex items-center justify-between px-4 py-2 bg-secondary/40">
                  <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {openRun.status === "IN_PROGRESS"
                      ? <>Clock running · {fmtClock(elapsedMin)} of {fmtClock(openTemplate?.totalPlannedMin ?? 0)} planned</>
                      : <>Submitted {openRun.completedAt ? new Date(openRun.completedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""} · actual {fmtClock(openRun.totalActualMin ?? 0)} vs {fmtClock(openRun.totalPlannedMin)} planned</>}
                  </p>
                  <button onClick={() => setOpenRunId(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close sheet">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="divide-y divide-border/60">
                  {openRun.entries.map((e, idx) => {
                    const cur = eff(e);
                    const st = cur.status;
                    const linked = e.rowId ? openTemplate?.rows.find((r) => r.id === e.rowId)?.machineId ?? null : null;
                    const machine = linked ? data.machines.find((m) => m.id === linked) : null;
                    const showHeader = idx === 0 || openRun.entries[idx - 1].machineName !== e.machineName;
                    return (
                      <div key={e.id}>
                        {showHeader && (
                          <div className="px-4 pt-3 pb-1 bg-primary/5 flex items-center justify-between">
                            <p className="text-[12px] font-bold">{e.machineName}</p>
                            {machine && <span className="text-[10px] text-muted-foreground">{machine.code}</span>}
                          </div>
                        )}
                        <div className="px-4 py-2.5">
                          <p className={`text-[13px] leading-snug ${st === "DONE" ? "text-muted-foreground" : ""}`}>{e.task}</p>
                          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-muted-foreground border border-border rounded-md px-1.5 py-0.5">{e.plannedMin} min</span>
                            {openRun.status === "IN_PROGRESS" ? (
                              STATUS_CHIPS.map((chip) => (
                                <button
                                  key={chip.id}
                                  onClick={() => onChip(openRun, e, chip.id)}
                                  className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${st === chip.id ? chip.activeCls : chip.cls}`}
                                >
                                  {chip.label}
                                </button>
                              ))
                            ) : (
                              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                                st === "DONE" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                : st === "FAULT" ? "border-red-500/40 bg-red-500/15 text-red-300"
                                : st === "SKIPPED" ? "border-zinc-500/40 bg-zinc-500/15 text-zinc-300"
                                : st === "RECHECK" ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                                : "border-border text-muted-foreground"
                              }`}>
                                {CHECKLIST_ROW_STATUS_META[st].label}
                              </span>
                            )}
                            {e.doneAt && st !== "PENDING" && <span className="text-[10px] text-muted-foreground">ticked {fmtTick(e.doneAt)}</span>}
                            {openRun.status === "IN_PROGRESS" && (
                              <>
                                <button
                                  onClick={() => setNoteFor(noteFor === e.id ? null : e.id)}
                                  className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${(cur.note ?? "").trim() ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}`}
                                >
                                  {(cur.note ?? "").trim() ? "Note ✓" : "+ Note"}
                                </button>
                                <button
                                  onClick={() => { photoEntryRef.current = e.id; fileRef.current?.click(); }}
                                  disabled={busy === e.id + ":photo"}
                                  className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${cur.photo ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}`}
                                >
                                  {busy === e.id + ":photo" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : cur.photo ? "Photo ✓" : <Camera className="h-3 w-3 inline" />}
                                </button>
                              </>
                            )}
                          </div>

                          {noteFor === e.id && openRun.status === "IN_PROGRESS" && (
                            <div className="mt-2">
                              <textarea
                                value={cur.note ?? ""}
                                onChange={(ev) => setOverrides((m) => ({ ...m, [e.id]: { ...cur, note: ev.target.value } }))}
                                onBlur={() => saveNote(openRun, e)}
                                rows={2}
                                maxLength={500}
                                placeholder={st === "FAULT" ? "Describe the fault for the Engineer…" : "Remark for this row (optional)…"}
                                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-primary/50"
                              />
                              <div className="mt-1 flex items-center justify-between">
                                <p className="text-[10px] text-muted-foreground">
                                  {machine ? "Faults on a linked machine alert the Engineer automatically." : "Not linked to a registry machine — the Engineer sees this in the sheet."}
                                </p>
                                <button onClick={() => saveNote(openRun, e)} className="text-[11px] font-bold text-primary">Save note</button>
                              </div>
                            </div>
                          )}
                          {!noteFor && (cur.note ?? "").trim() && (
                            <p className="mt-1.5 text-[11px] text-amber-300/90 flex items-start gap-1"><TriangleAlert className="h-3 w-3 mt-0.5 shrink-0" /> {cur.note}</p>
                          )}
                          {cur.photo && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={cur.photo} alt="Row photo" className="mt-2 rounded-xl border border-border max-h-36 object-cover" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {openRun.status === "IN_PROGRESS" && (
                  <div className="sticky bottom-16 md:bottom-4 border-t border-border bg-card/95 backdrop-blur p-3 space-y-2">
                    {confirmSubmit && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300 flex items-center justify-between gap-2">
                        <span>{liveCounts(openRun).pending} task(s) unticked — submit anyway?</span>
                        <button onClick={() => setConfirmSubmit(false)} className="font-bold underline underline-offset-2">Keep filling</button>
                      </div>
                    )}
                    <button
                      onClick={() => void submit(openRun)}
                      disabled={busy === openRun.id + ":submit"}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-4 py-3 text-[13px] font-bold disabled:opacity-60"
                    >
                      {busy === openRun.id + ":submit" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                      Submit sheet — stops the clock
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* History */}
      {(weekData?.history.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[13px] font-bold">My past sheets</p>
            <p className="text-[11px] text-muted-foreground">Planned vs actual minutes — the Engineer&apos;s efficiency board uses this</p>
          </div>
          <div className="divide-y divide-border/60">
            {weekData!.history.map((r) => (
              <div key={r.id}>
                <button
                  onClick={() => setExpandedHistory(expandedHistory === r.id ? null : r.id)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-accent/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold truncate">{fmtWeek(r.weekStart)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {r.counts.done}/{r.counts.total} done · {fmtClock(r.totalActualMin ?? 0)} actual vs {fmtClock(r.totalPlannedMin)} planned
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      r.status === "ACKNOWLEDGED" ? "border-emerald-500/40 text-emerald-300"
                      : "border-amber-500/40 text-amber-300"
                    }`}>
                      {r.status === "ACKNOWLEDGED" ? "Approved" : "Awaiting approval"}
                    </span>
                    {expandedHistory === r.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>
                {expandedHistory === r.id && (
                  <div className="px-4 pb-3 space-y-1">
                    {r.entries.map((e) => (
                      <div key={e.id} className="flex items-start justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground min-w-0 truncate">{e.machineName} — {e.task}</span>
                        <span className={`shrink-0 font-semibold ${
                          e.status === "DONE" ? "text-emerald-400" : e.status === "FAULT" ? "text-red-400" : e.status === "RECHECK" ? "text-amber-400" : "text-muted-foreground"
                        }`}>
                          {CHECKLIST_ROW_STATUS_META[e.status].short}{e.doneAt ? ` ${fmtTick(e.doneAt)}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(ev) => {
          const run = openRun;
          if (run && photoEntryRef.current) void addPhoto(run, photoEntryRef.current, ev.target.files?.[0]);
        }}
      />
    </div>
  );
}
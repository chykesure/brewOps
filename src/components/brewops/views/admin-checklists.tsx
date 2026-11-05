"use client";

// Engineer's Weekly Checklists command view:
//   1. This-week compliance + 6-week grid (green done · amber late/incomplete · red missing)
//   2. Efficiency ranking — planned vs actual minutes per artisan (the paper never could)
//   3. Re-check queue — FAULT/RECHECK rows carried for the next round
//   4. Recent sheets — full drill-down, acknowledgement, print to paper layout
//   5. Template editor — the two scanned sheets are fully editable here
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BootstrapData, ChecklistAdminData, ChecklistRunDTO, ChecklistTemplateDTO, ChecklistCellState } from "@/lib/types";
import { CHECKLIST_ROW_STATUS_META } from "@/lib/types";
import {
  fetchChecklistsAdmin, fetchChecklistRun, checklistAck, checklistResolveRecheck,
  checklistTemplatesSave, checklistTemplateCreate,
} from "@/lib/client-api";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BadgeCheck, ChevronDown, ClipboardList, Download, LoaderCircle, Pencil, Plus,
  Printer, RefreshCw, Trophy, Wrench,
} from "lucide-react";

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}
function fmtWeek(weekISO: string): string {
  const s = new Date(weekISO);
  const e = new Date(s.getTime() + 6 * 86400_000);
  const f = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${f(s)} – ${f(e)}`;
}
function fmtClock(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

const CELL_STYLE: Record<ChecklistCellState, { cls: string; label: string }> = {
  GREEN: { cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "Done" },
  AMBER: { cls: "bg-amber-500/20 text-amber-300 border-amber-500/40", label: "Partial/Late" },
  RED:   { cls: "bg-red-500/15 text-red-300 border-red-500/40", label: "Missing" },
  OPEN:  { cls: "bg-sky-500/15 text-sky-300 border-sky-500/40", label: "In progress" },
  NONE:  { cls: "bg-secondary/50 text-muted-foreground border-border", label: "—" },
};

type EditorRow = { id?: string; machineName: string; machineId: string | null; task: string; plannedMin: number; active: boolean };

export default function AdminChecklists({ data }: { data: BootstrapData }) {
  const [admin, setAdmin] = useState<ChecklistAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);

  // run detail dialog
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChecklistRunDTO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ackNote, setAckNote] = useState("");

  // template editor
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editRows, setEditRows] = useState<EditorRow[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTrade, setNewTrade] = useState<"MECHANICAL" | "ELECTRICAL">("MECHANICAL");

  const weekISO = useMemo(() => mondayOf(new Date()).toISOString(), []);

  const load = useCallback(async () => {
    try {
      const d = await fetchChecklistsAdmin(weekISO, days);
      setAdmin(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load checklists");
    } finally {
      setLoading(false);
    }
  }, [weekISO, days]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (runId: string) => {
    setDetailId(runId);
    setDetail(null);
    setAckNote("");
    setDetailLoading(true);
    try {
      const res = await fetchChecklistRun(runId);
      setDetail(res.run);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the sheet");
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const ack = async (runId: string) => {
    setBusy(runId + ":ack");
    try {
      await checklistAck(runId, ackNote.trim() || undefined);
      toast.success("Sheet acknowledged");
      setDetailId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not acknowledge");
    } finally {
      setBusy(null);
    }
  };

  const resolveRecheck = async (entryId: string) => {
    setBusy(entryId + ":recheck");
    try {
      await checklistResolveRecheck(entryId);
      toast.success("Re-check cleared");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clear");
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (t: ChecklistTemplateDTO) => {
    setEditing(t.id);
    setEditTitle(t.title);
    setEditActive(t.active);
    setEditRows(t.rows.filter((r) => r.active).map((r) => ({ id: r.id, machineName: r.machineName, machineId: r.machineId, task: r.task, plannedMin: r.plannedMin, active: r.active })));
  };

  const saveTemplate = async () => {
    if (!editing) return;
    setSavingTemplate(true);
    try {
      await checklistTemplatesSave({ templateId: editing, title: editTitle, active: editActive, rows: editRows });
      toast.success("Template saved");
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingTemplate(false);
    }
  };

  const createTemplate = async () => {
    if (newTitle.trim().length < 4) { toast.error("Give the sheet a clear title"); return; }
    setBusy("new");
    try {
      await checklistTemplateCreate(newTitle.trim(), newTrade);
      toast.success("Sheet template created — add its rows below");
      setNewTitle("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create");
    } finally {
      setBusy(null);
    }
  };

  const printRun = (run: ChecklistRunDTO) => {
    const rows = run.entries.map((e) => {
      const st = CHECKLIST_ROW_STATUS_META[e.status].short;
      return `<tr><td>${escapeHtml(e.machineName)}</td><td>${escapeHtml(e.task)}</td><td class="n">${e.plannedMin}</td><td>${escapeHtml(st)}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(run.templateTitle ?? "Weekly Checklist")}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#111}h1{font-size:16px;text-align:center;margin:0 0 2px}p.meta{text-align:center;font-size:12px;margin:0 0 14px;color:#333}
table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #444;padding:5px 7px;text-align:left}th{background:#eee}
td.n{text-align:right;width:70px}.tot td{font-weight:bold;background:#f3f3f3}.foot{margin-top:16px;font-size:11px;color:#333;display:flex;justify-content:space-between}</style></head><body>
<h1>${escapeHtml(run.templateTitle ?? "Weekly Maintenance Checklist")}</h1>
<p class="meta">Week ${fmtWeek(run.weekStart)} · ${escapeHtml(run.artisanName)}${run.shift ? ` · Shift ${escapeHtml(run.shift)}` : ""} · Submitted ${run.completedAt ? new Date(run.completedAt).toLocaleString("en-GB") : "—"}</p>
<table><thead><tr><th>Equipment</th><th>Task</th><th>Mins</th><th>Status</th></tr></thead><tbody>
 ${rows}
<tr class="tot"><td>Total</td><td></td><td class="n">${run.totalPlannedMin}</td><td>Actual ${fmtClock(run.totalActualMin ?? 0)} · ${run.counts.done}/${run.counts.total} done</td></tr>
</tbody></table>
<p class="foot"><span>Artisan: ${escapeHtml(run.artisanName)}</span><span>Engineer: ${escapeHtml(run.ackByName ?? data.user.name)}</span></p>
</body></html>`;
    const w = window.open("", "_blank", "width=860,height=1000");
    if (!w) { toast.error("Allow pop-ups to print the sheet"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  if (loading) {
    return (
      <div className="px-4 py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Loading checklists…
      </div>
    );
  }
  if (!admin) return null;

  const thisWeek = admin.weeks[0];
  const openRechecks = admin.recheckQueue.length;
  const awaiting = admin.recentRuns.filter((r) => r.status === "SUBMITTED").length;

  return (
    <div className="px-4 py-4 space-y-4 max-w-md mx-auto md:max-w-6xl">
      {/* Header */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold leading-tight">Weekly Checklists</h1>
              <p className="text-[11px] text-muted-foreground">The digitised paper inspection sheets · {fmtWeek(weekISO)}</p>
            </div>
          </div>
          <button onClick={() => void load()} className="rounded-lg border border-border p-2 hover:bg-accent/50" aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border bg-secondary/40 p-2.5 text-center">
            <p className="text-[15px] font-bold text-emerald-400">{thisWeek?.cells.filter((c) => c.state === "GREEN").length ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Sheets done this week</p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/40 p-2.5 text-center">
            <p className="text-[15px] font-bold text-amber-400">{awaiting}</p>
            <p className="text-[10px] text-muted-foreground">Awaiting your approval</p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/40 p-2.5 text-center">
            <p className="text-[15px] font-bold text-red-400">{openRechecks}</p>
            <p className="text-[10px] text-muted-foreground">Re-checks open</p>
          </div>
        </div>
      </div>

      {/* Compliance grid */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[13px] font-bold">Compliance — last 6 weeks</p>
          <p className="text-[11px] text-muted-foreground">Green done on time · amber late or incomplete · red missing</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-2 font-semibold min-w-[190px]">Sheet</th>
                {admin.weeks.map((w) => (
                  <th key={w.weekStart} className="px-2 py-2 font-semibold whitespace-nowrap">{fmtWeek(w.weekStart)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {admin.templates.filter((t) => admin.weeks.some((w) => w.cells.some((c) => c.templateId === t.id))).map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-medium">{t.title.replace("Weekly Maintenance ", "").replace(" Inspection Checklist", "")}</td>
                  {admin.weeks.map((w) => {
                    const cell = w.cells.find((c) => c.templateId === t.id);
                    const st = CELL_STYLE[cell?.state ?? "NONE"];
                    return (
                      <td key={w.weekStart} className="px-2 py-2 text-center">
                        <span title={cell?.artisanNames.join(", ") || st.label} className={`inline-block rounded-md border px-2 py-1 text-[10px] font-bold ${st.cls}`}>
                          {cell && cell.runCount > 0 ? `${st.label} · ${cell.runCount}` : st.label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Efficiency ranking */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-[13px] font-bold">Artisan effectiveness — checklists</p>
            <p className="text-[11px] text-muted-foreground">Last {admin.days} days · completion first, faster pace breaks ties</p>
          </div>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-border bg-background text-[11px] px-2 py-1.5">
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={56}>8 weeks</option>
            <option value={91}>Quarter</option>
          </select>
        </div>
        {admin.ranking.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted-foreground">No submitted sheets in this window yet — the board fills as artisans submit.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {admin.ranking.map((r, i) => (
              <div key={r.artisanId} className="px-4 py-3 flex items-center gap-3">
                <span className={`h-7 w-7 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0 ${i === 0 ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-secondary/60 text-muted-foreground"}`}>
                  {i === 0 ? <Trophy className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold truncate">{r.name} <span className="text-[10px] text-muted-foreground font-normal">{r.trade ?? "—"} · Shift {r.shift ?? "—"}</span></p>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${r.completionPct}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {r.runs} sheet{r.runs === 1 ? "" : "s"} · {r.tasksDone}/{r.tasksTotal} tasks ({r.completionPct}%)
                    {r.avgActualMin !== null && <> · actual {fmtClock(r.avgActualMin)} vs {fmtClock(r.avgPlannedMin ?? 0)} planned{r.pacePct !== null ? ` · ${r.pacePct}% pace` : ""}</>}
                    {r.faults > 0 && <> · <span className="text-red-400">{r.faults} fault{r.faults === 1 ? "" : "s"}</span></>}
                    {r.rechecks > 0 && <> · <span className="text-amber-400">{r.rechecks} re-check</span></>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="px-4 py-2 border-t border-border/60 text-[10px] text-muted-foreground">
          Work-order speed and on-time rates live in the <span className="font-semibold">Trends</span> tab — this board tracks the weekly paper sheets.
        </p>
      </div>

      {/* Re-check queue */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[13px] font-bold">Re-check queue</p>
          <p className="text-[11px] text-muted-foreground">Rows flagged NEEDS RE-CHECK or with faults — clear them once fixed</p>
        </div>
        {admin.recheckQueue.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted-foreground">Queue is empty. 👍</p>
        ) : (
          <div className="divide-y divide-border/60">
            {admin.recheckQueue.map((item) => (
              <div key={item.entryId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold">{item.machineName} <span className="text-[10px] font-normal text-muted-foreground">· {item.templateTitle.replace("Weekly Maintenance ", "").replace(" Inspection Checklist", "")}</span></p>
                    <p className="text-[11px] text-muted-foreground">{item.task}</p>
                    {item.note && <p className="mt-1 text-[11px] text-amber-300">“{item.note}”</p>}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{item.artisanName} · week of {fmtWeek(item.weekStart)}</p>
                  </div>
                  <button
                    onClick={() => void resolveRecheck(item.entryId)}
                    disabled={busy === item.entryId + ":recheck"}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-60"
                  >
                    {busy === item.entryId + ":recheck" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
                    Resolve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent sheets */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[13px] font-bold">Submitted sheets</p>
          <p className="text-[11px] text-muted-foreground">Tap a sheet to review every tick, then acknowledge it</p>
        </div>
        {admin.recentRuns.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-muted-foreground">Nothing submitted yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {admin.recentRuns.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold truncate">{r.artisanName} <span className="text-[10px] font-normal text-muted-foreground">· {r.templateTitle?.replace("Weekly Maintenance ", "").replace(" Inspection Checklist", "")}</span></p>
                  <p className="text-[10px] text-muted-foreground">
                    {fmtWeek(r.weekStart)} · {r.counts.done}/{r.counts.total} done{r.counts.fault ? ` · ${r.counts.fault} fault` : ""} · {fmtClock(r.totalActualMin ?? 0)} vs {fmtClock(r.totalPlannedMin)} planned
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    r.status === "ACKNOWLEDGED" ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"
                  }`}>
                    {r.status === "ACKNOWLEDGED" ? "Approved" : "To approve"}
                  </span>
                  <button onClick={() => void openDetail(r.id)} className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent/50">Open</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Template editor */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[13px] font-bold">Sheet templates</p>
          <p className="text-[11px] text-muted-foreground">Edit equipment, tasks and planned minutes — seeded from your scanned paper sheets</p>
        </div>
        <div className="divide-y divide-border/60">
          {admin.templates.map((t) => (
            <div key={t.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold truncate">{t.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {t.trade} · {t.rows.filter((r) => r.active).length} rows · planned {fmtClock(t.totalPlannedMin)} {!t.active && "· RETIRED"}
                  </p>
                </div>
                <button onClick={() => (editing === t.id ? setEditing(null) : startEdit(t))} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent/50">
                  <Pencil className="h-3.5 w-3.5" /> {editing === t.id ? "Close" : "Edit"}
                </button>
              </div>

              {editing === t.id && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 py-2 text-[12px]" placeholder="Sheet title" />
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} className="h-3.5 w-3.5" /> Active
                    </label>
                  </div>
                  <div className="space-y-2 max-h-80 overflow-y-auto brewops-scroll">
                    {editRows.map((row, i) => (
                      <div key={row.id ?? `new-${i}`} className="rounded-xl border border-border p-2.5 space-y-1.5">
                        <div className="flex gap-1.5">
                          <input value={row.machineName} onChange={(e) => setEditRows((rs) => rs.map((r, j) => (j === i ? { ...r, machineName: e.target.value } : r)))} className="w-32 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]" placeholder="Equipment" />
                          <input value={row.task} onChange={(e) => setEditRows((rs) => rs.map((r, j) => (j === i ? { ...r, task: e.target.value } : r)))} className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]" placeholder="Task" />
                          <input type="number" min={1} max={600} value={row.plannedMin} onChange={(e) => setEditRows((rs) => rs.map((r, j) => (j === i ? { ...r, plannedMin: Math.max(1, Number(e.target.value) || 1) } : r)))} className="w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]" title="Planned minutes" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <select
                            value={row.machineId ?? ""}
                            onChange={(e) => setEditRows((rs) => rs.map((r, j) => (j === i ? { ...r, machineId: e.target.value || null } : r)))}
                            className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground"
                          >
                            <option value="">Link to registry machine (optional)…</option>
                            {data.machines.map((m) => (
                              <option key={m.id} value={m.id}>{m.code} · {m.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setEditRows((rs) => rs.filter((_, j) => j !== i))}
                            className="rounded-lg border border-red-500/40 text-red-400 px-2 py-1.5 text-[10px] font-bold"
                            title="Remove row (history is kept)"
                          >
                            <Wrench className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setEditRows((rs) => [...rs, { machineName: "", machineId: null, task: "", plannedMin: 10, active: true }])} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent/50">
                      <Plus className="h-3.5 w-3.5" /> Add row
                    </button>
                    <button onClick={() => void saveTemplate()} disabled={savingTemplate} className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-bold disabled:opacity-60">
                      {savingTemplate ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />} Save template
                    </button>
                    <p className="text-[10px] text-muted-foreground">Removed rows are retired, never deleted — past ticks stay in history.</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-border space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground">Add a new sheet</p>
          <div className="flex flex-wrap gap-1.5">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="flex-1 min-w-[180px] rounded-lg border border-border bg-background px-3 py-2 text-[12px]" placeholder="e.g. Weekly Utilities Inspection Checklist" />
            <select value={newTrade} onChange={(e) => setNewTrade(e.target.value as "MECHANICAL" | "ELECTRICAL")} className="rounded-lg border border-border bg-background px-2 py-2 text-[11px]">
              <option value="MECHANICAL">Mechanical</option>
              <option value="ELECTRICAL">Electrical</option>
            </select>
            <button onClick={() => void createTemplate()} disabled={busy === "new"} className="inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-[11px] font-bold disabled:opacity-60">
              {busy === "new" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
            </button>
          </div>
        </div>
      </div>

      {/* Run detail dialog */}
      <Dialog open={detailId !== null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto brewops-scroll">
          {detailLoading || !detail ? (
            <div className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Opening the sheet…
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-left text-[15px] leading-snug">{detail.templateTitle}</DialogTitle>
                <p className="text-[11px] text-muted-foreground text-left">
                  {fmtWeek(detail.weekStart)} · {detail.artisanName}{detail.shift ? ` · Shift ${detail.shift}` : ""} · submitted {detail.completedAt ? new Date(detail.completedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                </p>
              </DialogHeader>

              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="rounded-lg border border-border bg-secondary/40 p-1.5"><p className="text-[13px] font-bold text-emerald-400">{detail.counts.done}</p><p className="text-[9px] text-muted-foreground">Done</p></div>
                <div className="rounded-lg border border-border bg-secondary/40 p-1.5"><p className="text-[13px] font-bold text-red-400">{detail.counts.fault}</p><p className="text-[9px] text-muted-foreground">Faults</p></div>
                <div className="rounded-lg border border-border bg-secondary/40 p-1.5"><p className="text-[13px] font-bold">{fmtClock(detail.totalActualMin ?? 0)}</p><p className="text-[9px] text-muted-foreground">Actual</p></div>
                <div className="rounded-lg border border-border bg-secondary/40 p-1.5"><p className="text-[13px] font-bold">{fmtClock(detail.totalPlannedMin)}</p><p className="text-[9px] text-muted-foreground">Planned</p></div>
              </div>

              <div className="rounded-xl border border-border divide-y divide-border/60">
                {detail.entries.map((e) => (
                  <div key={e.id} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-muted-foreground">{e.machineName}</p>
                        <p className="text-[12px] leading-snug">{e.task}</p>
                        {e.note && <p className="mt-0.5 text-[11px] text-amber-300">“{e.note}”</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          e.status === "DONE" ? "border-emerald-500/40 text-emerald-300"
                          : e.status === "FAULT" ? "border-red-500/40 text-red-300"
                          : e.status === "SKIPPED" ? "border-zinc-500/40 text-zinc-300"
                          : e.status === "RECHECK" ? "border-amber-500/40 text-amber-300"
                          : "border-border text-muted-foreground"
                        }`}>{CHECKLIST_ROW_STATUS_META[e.status].short}</span>
                        {e.doneAt && <p className="mt-0.5 text-[9px] text-muted-foreground">{new Date(e.doneAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>}
                      </div>
                    </div>
                    {e.photo && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={e.photo} alt="Row photo" className="mt-1.5 rounded-lg border border-border max-h-32 object-cover" />
                    )}
                    {e.status === "RECHECK" && !e.recheckResolvedAt && (
                      <button onClick={() => void resolveRecheck(e.id).then(() => void openDetail(detail.id))} className="mt-1.5 rounded-lg bg-emerald-600 text-white px-2 py-1 text-[10px] font-bold">Resolve re-check</button>
                    )}
                  </div>
                ))}
              </div>

              {detail.status === "SUBMITTED" ? (
                <div className="space-y-2">
                  <input value={ackNote} onChange={(e) => setAckNote(e.target.value)} placeholder="Optional note to the artisan…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px]" />
                  <button onClick={() => void ack(detail.id)} disabled={busy === detail.id + ":ack"} className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-bold disabled:opacity-60">
                    {busy === detail.id + ":ack" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Acknowledge sheet
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-emerald-300 flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" /> Acknowledged by {detail.ackByName ?? "the Engineer"}{detail.ackNote ? ` — “${detail.ackNote}”` : ""}</p>
              )}

              <button onClick={() => printRun(detail)} className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-[12px] font-semibold hover:bg-accent/50">
                <Printer className="h-4 w-4" /> Print as paper sheet
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
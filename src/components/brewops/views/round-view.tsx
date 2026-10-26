"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BootstrapData, ComponentDTO, MachineDTO, StatusLogDTO } from "@/lib/types";
import { StatusBadge } from "@/components/brewops/status-badge";
import StatusPickerSheet from "@/components/brewops/status-picker-sheet";
import ComponentHistorySheet from "@/components/brewops/component-history-sheet";
import PmHistoryPanel from "@/components/brewops/pm-history-panel";
import MachineStatusReport from "@/components/brewops/machine-status-report";
import { STATUS_META, pmCycleLabel } from "@/lib/status";
import { suggestMachineCode, suggestComponentPartCode } from "@/lib/machine-code";
import { createComponent, createMachine } from "@/lib/client-api";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Search, Radar, CheckCircle2, Circle, Wrench,
  PackageOpen, Lock, Plus, MapPin, CalendarClock, History, X, LoaderCircle, FileText, ListTree, RefreshCw,
} from "lucide-react";

type ViewMode = { type: "list" } | { type: "machine"; machineId: string };

// One-tap sub-components — the common equipment every brewery machine carries.
// Tapping a chip fills the name + category; the part code stays auto-generated.
const QUICK_COMPONENTS: { name: string; category: string }[] = [
  { name: "Drive Motor", category: "Rotating" },
  { name: "Pump Impeller", category: "Rotating" },
  { name: "Mechanical Seal", category: "Seal" },
  { name: "Bearing", category: "Bearing" },
  { name: "Solenoid Valve", category: "Valve" },
  { name: "Flow Transmitter", category: "Instrument" },
  { name: "Temperature Probe", category: "Instrument" },
  { name: "Pressure Gauge", category: "Instrument" },
];

export default function RoundView({
  data, refresh, startMode, onConsumeStart,
}: {
  data: BootstrapData; refresh: () => void; startMode?: "round" | "register"; onConsumeStart?: () => void;
}) {
  const [view, setView] = useState<ViewMode>({ type: "list" });
  const [mode, setMode] = useState<"round" | "register">(startMode === "register" ? "register" : "round");
  const [pickedMachine, setPickedMachine] = useState<MachineDTO | null>(null);
  const [regDept, setRegDept] = useState("all");
  const [regCat, setRegCat] = useState("all");
  const [regState, setRegState] = useState<"all" | "attention" | "ok">("all");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "pending">("all");
  const [picked, setPicked] = useState<ComponentDTO | null>(null);
  const [history, setHistory] = useState<{ comp: ComponentDTO | null; logs: StatusLogDTO[] }>({ comp: null, logs: [] });
  const [addOpen, setAddOpen] = useState(false);
  const [newComp, setNewComp] = useState({ name: "", partCode: "", category: "" });
  // Auto part code — editable; a manual keystroke stops the auto-suggestion
  const [partTouched, setPartTouched] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);
  // Printable status log report (last 7 days, company letterhead)
  const [printOpen, setPrintOpen] = useState(false);
  // Register a new machine straight from the floor (artisans see new equipment first)
  const [regOpen, setRegOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nm, setNm] = useState({ code: "", name: "", departmentId: "", newDept: "", location: "", pmCycle: "NONE" });
  // Auto code — editable; manual keystrokes stop the auto-suggestion
  const [codeTouched, setCodeTouched] = useState(false);
  const compNameRef = useRef<HTMLInputElement | null>(null);

  const isAdmin = data.user.role === "ADMIN";
  const machine = view.type === "machine" ? data.machines.find((m) => m.id === view.machineId) : null;

  // Opened from the Home "Plant Status Register" card — consume the one-shot navigation flag
  useEffect(() => {
    if (startMode === "register") onConsumeStart?.();
  }, []);

  const depts = useMemo(() => {
    const set = new Map<string, string>();
    data.machines.forEach((m) => set.set(m.departmentId, m.departmentName));
    return Array.from(set.entries());
  }, [data.machines]);

  const machinesFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.machines.filter((m) => {
      if (q && !(`${m.code} ${m.name} ${m.departmentName}`.toLowerCase().includes(q))) return false;
      if (filter === "attention") {
        return m.components.some((c) => STATUS_META[c.currentStatus].alert);
      }
      if (filter === "pending") {
        return m.components.some((c) => !c.reportedToday);
      }
      return true;
    });
  }, [data.machines, query, filter]);

  const machineProgress = (m: (typeof data.machines)[number]) => {
    const done = m.components.filter((c) => c.reportedToday).length;
    return { done, total: m.components.length, attention: m.components.filter((c) => STATUS_META[c.currentStatus].alert).length };
  };

  // ---- Plant Status Register: every component of every machine, flat and filterable.
  // Built from whatever departments exist (Brewhouse today; Packaging tomorrow) so the
  // register follows the plant structure automatically as it grows. ----
  const categories = useMemo(
    () => [...new Set(data.machines.flatMap((m) => m.components.map((c) => c.category ?? "Other")))].sort(),
    [data.machines]
  );
  const regRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.machines.flatMap((m) =>
      m.components
        .filter((c) => {
          if (regDept !== "all" && m.departmentId !== regDept) return false;
          if (regCat !== "all" && (c.category ?? "Other") !== regCat) return false;
          if (regState === "attention" && !STATUS_META[c.currentStatus].alert) return false;
          if (regState === "ok" && STATUS_META[c.currentStatus].alert) return false;
          if (q && !(`${m.code} ${m.name} ${m.departmentName} ${c.name} ${c.partCode ?? ""} ${c.category ?? ""}`.toLowerCase().includes(q))) return false;
          return true;
        })
        .map((c) => ({ c, m }))
    );
  }, [data.machines, query, regDept, regCat, regState]);
  const regGroups = useMemo(() => {
    const map = new Map<string, { m: MachineDTO; rows: { c: ComponentDTO; m: MachineDTO }[] }>();
    for (const r of regRows) {
      const g = map.get(r.m.id) ?? { m: r.m, rows: [] };
      g.rows.push(r);
      map.set(r.m.id, g);
    }
    return Array.from(map.values());
  }, [regRows]);
  const regTotalComps = data.machines.reduce((a, m) => a + m.components.length, 0);

  const openHistory = (comp: ComponentDTO, logs: StatusLogDTO[]) => {
    setPicked(null);
    setHistory({ comp, logs });
  };

  const deptName = (id: string) => depts.find(([did]) => did === id)?.[1] ?? null;
  const suggestFor = (departmentId: string, newDeptText?: string) =>
    suggestMachineCode(
      departmentId === "__new" ? ((newDeptText ?? nm.newDept).trim() || null) : deptName(departmentId),
      data.machines,
    );
  const regenCode = () => {
    setNm((s) => ({ ...s, code: suggestFor(s.departmentId) }));
    setCodeTouched(false);
  };
  // Opening the floor registration panel hands the artisan a fresh code right away
  const openRegister = () => {
    const opening = !regOpen;
    setRegOpen(opening);
    if (opening && !codeTouched) {
      setNm((s) => ({ ...s, code: s.code.trim() ? s.code : suggestMachineCode(null, data.machines) }));
    }
  };

  // Focus the component name input whenever the add-component panel opens on a machine
  useEffect(() => {
    if (view.type === "machine" && addOpen) {
      const t = setTimeout(() => compNameRef.current?.focus(), 300);
      // Hand the floor crew a fresh letters+numbers part code (CP-7K3M style) —
      // the code input never blocks a registration from the floor.
      if (!partTouched) setNewComp((s) => ({ ...s, partCode: s.partCode.trim() ? s.partCode : suggestComponentPartCode(data.machines) }));
      return () => clearTimeout(t);
    }
  }, [view, addOpen]);

  const regenPartCode = () => {
    setPartTouched(false);
    setNewComp((s) => ({ ...s, partCode: suggestComponentPartCode(data.machines) }));
  };

  const isNewDept = nm.departmentId === "__new";

  const saveMachine = async () => {
    if (!nm.name.trim()) {
      toast.error("Machine name is required");
      return;
    }
    if (!nm.departmentId || (isNewDept && !nm.newDept.trim())) {
      toast.error("Pick a department (or type a new one)");
      return;
    }
    setBusy(true);
    try {
      const created = await createMachine({
        code: nm.code.trim() || undefined, name: nm.name,
        ...(isNewDept ? { departmentName: nm.newDept } : { departmentId: nm.departmentId }),
        location: nm.location || undefined,
        pmCycle: nm.pmCycle,
      });
      toast.success(`${created.code} registered`, {
        description: "It is now in your round — add its components below.",
      });
      setNm({ code: "", name: "", departmentId: "", newDept: "", location: "", pmCycle: "NONE" });
      setCodeTouched(false);
      setRegOpen(false);
      refresh();
      // Jump straight into the new machine so the floor crew can wire up its
      // sub-components while they are still standing in front of it.
      setView({ type: "machine", machineId: created.id });
      setAddOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not register the machine");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Machine detail ----------
  // Just registered and the fresh bootstrap hasn't landed yet — hold on a loading card.
  if (view.type === "machine" && !machine) {
    return (
      <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
        <button onClick={() => setView({ type: "list" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" /> All machines
        </button>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <LoaderCircle className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground mt-2">Opening the new machine…</p>
        </div>
      </div>
    );
  }

  // ---------- Machine list ----------
  if (view.type === "list") {
    return (
      <div className="p-4 md:p-6 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-lg font-bold tracking-tight">My Round</h1>
            <p className="text-xs text-muted-foreground">Every machine, valve, instrument and component in the plant is here. Tap one, tap a component, log its true state.</p>
          </div>
          <div className="flex rounded-xl border border-border bg-card p-1" role="group" aria-label="Round view mode">
            <button
              onClick={() => setMode("round")}
              className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${mode === "round" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={mode === "round"}
            >
              <Radar className="h-3.5 w-3.5" /> Round
            </button>
            <button
              onClick={() => setMode("register")}
              className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${mode === "register" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={mode === "register"}
            >
              <ListTree className="h-3.5 w-3.5" /> Plant register
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "register" ? "Search machine, component, part code…" : "Search machine or code…"}
            className="w-full h-11 rounded-xl bg-card border border-input pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {mode === "round" && (
        <>
        <div className="flex gap-2">
          {([
            { id: "all", label: "All" },
            { id: "pending", label: "Not yet reported" },
            { id: "attention", label: "Attention" },
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

        {/* Shop-floor registration — the floor crew spots new equipment before anyone */}
        <button
          onClick={openRegister}
          className="w-full h-11 rounded-xl border border-primary/40 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Register new machine
        </button>

        {regOpen && (
          <div className="rounded-xl border border-border bg-card p-3 space-y-2 md:max-w-3xl">
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <input value={nm.code} onChange={(e) => { setNm({ ...nm, code: e.target.value }); setCodeTouched(true); }} placeholder="Auto code (editable)" className="w-full h-10 rounded-lg bg-background border border-input pl-3 pr-9 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/50" />
                <button type="button" onClick={regenCode} title="Generate a fresh code"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md bg-secondary border border-border flex items-center justify-center hover:bg-accent">
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              <input value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} placeholder="Machine name" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={nm.departmentId} onChange={(e) => { const v = e.target.value; if (!codeTouched) setNm((s) => ({ ...s, departmentId: v, code: suggestFor(v) })); else setNm({ ...nm, departmentId: v }); }} className="w-full h-10 rounded-lg bg-background border border-input px-2 text-sm outline-none">
                <option value="">Department…</option>
                {depts.map(([id, dname]) => <option key={id} value={id}>{dname}</option>)}
                <option value="__new">New department…</option>
              </select>
              {isNewDept ? (
                <input value={nm.newDept} onChange={(e) => { const v = e.target.value; if (!codeTouched) setNm((s) => ({ ...s, newDept: v, code: suggestFor("__new", v) })); else setNm({ ...nm, newDept: v }); }} placeholder="New department name" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
              ) : (
                <input value={nm.location} onChange={(e) => setNm({ ...nm, location: e.target.value })} placeholder="Location (optional)" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
              )}
            </div>
            {isNewDept && (
              <input value={nm.location} onChange={(e) => setNm({ ...nm, location: e.target.value })} placeholder="Location (optional)" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
            )}
            <div className="grid grid-cols-2 gap-2">
              <select value={nm.pmCycle} onChange={(e) => setNm({ ...nm, pmCycle: e.target.value })} className="w-full h-10 rounded-lg bg-background border border-input px-2 text-sm outline-none">
                {["NONE", "DAILY", "WEEKLY", "MONTHLY"].map((c) => <option key={c} value={c}>{c === "NONE" ? "No PM yet" : c}</option>)}
              </select>
              <button onClick={saveMachine} disabled={busy} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Register machine
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">The machine lands in your round immediately. The Engineer sets the PM plan, geofence and ownership details afterwards in the Registry.</p>
          </div>
        )}
        </>
        )}

        {mode === "register" && (
          <>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-bold flex items-center gap-1.5">
                <ListTree className="h-4 w-4 text-primary" /> Plant Status Register
              </p>
              <p className="text-[10.5px] text-muted-foreground mt-0.5">
                The live status of every machine, valve, instrument and component across all departments — Brewing, Utilities, Packaging, whatever the plant grows into. Tap any line to log its true state.
              </p>
              <p className="text-[10px] mt-2 font-mono text-muted-foreground">
                {data.machines.length} machines · {regTotalComps} components · {depts.length} department{depts.length === 1 ? "" : "s"}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setRegDept("all")} className={`h-7 px-2.5 rounded-full text-[10px] font-semibold border transition-colors ${regDept === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>All departments</button>
                {depts.map(([id, dname]) => (
                  <button key={id} onClick={() => setRegDept(id)} className={`h-7 px-2.5 rounded-full text-[10px] font-semibold border transition-colors ${regDept === id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{dname}</button>
                ))}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setRegCat("all")} className={`h-7 px-2.5 rounded-full text-[10px] font-semibold border transition-colors ${regCat === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>All kinds</button>
                {categories.map((cat) => (
                  <button key={cat} onClick={() => setRegCat(cat)} className={`h-7 px-2.5 rounded-full text-[10px] font-semibold border transition-colors ${regCat === cat ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{cat}</button>
                ))}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  { id: "all", label: "All statuses" },
                  { id: "attention", label: "Needs attention" },
                  { id: "ok", label: "Healthy" },
                ] as const).map((s) => (
                  <button key={s.id} onClick={() => setRegState(s.id)} className={`h-7 px-2.5 rounded-full text-[10px] font-semibold border transition-colors ${regState === s.id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{s.label}</button>
                ))}
                <span className="ml-auto self-center text-[10px] text-muted-foreground font-mono">{regRows.length} shown</span>
              </div>
            </div>

            {regGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10 rounded-xl border border-border bg-card">Nothing matches. Clear the filters above.</p>
            ) : (
              regGroups.map(({ m, rows }) => (
                <div key={m.id}>
                  <button
                    onClick={() => setView({ type: "machine", machineId: m.id })}
                    className="w-full flex items-center justify-between gap-2 px-1 py-1.5 text-left group"
                  >
                    <p className="text-[12px] font-bold truncate">
                      <span className="text-primary font-mono text-[11px] mr-1.5">{m.code}</span>
                      {m.name}
                      <span className="ml-2 text-[9.5px] font-semibold text-muted-foreground">{m.departmentName}</span>
                    </p>
                    <span className="text-[9px] text-muted-foreground shrink-0 flex items-center gap-1">
                      {rows.length} line{rows.length === 1 ? "" : "s"}
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  </button>
                  <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
                    {rows.map(({ c }) => {
                      const meta = STATUS_META[c.currentStatus];
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setPickedMachine(m);
                            setPicked(c);
                          }}
                          className="w-full px-3.5 py-3 flex items-center justify-between gap-2 hover:bg-accent/40 transition-colors text-left"
                        >
                          <div className="min-w-0 flex items-center gap-2.5">
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${meta.dot}`} />
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold truncate">
                                {c.name}
                                {c.category ? <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-px">{c.category}</span> : null}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {c.partCode ? `${c.partCode} · ` : ""}
                                {c.reportedToday ? "reported today ✓" : c.lastLog ? `last ${new Date(c.lastLog.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "no status on record"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {meta.alert && <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" title="Engineer alerted" />}
                            <StatusBadge status={c.currentStatus} size="xs" />
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {mode === "round" && (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 md:items-start">
          {machinesFiltered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-10">No machines match. Try clearing the filter.</p>
          )}
          {machinesFiltered.map((m) => {
            const p = machineProgress(m);
            const complete = p.total > 0 && p.done === p.total;
            return (
              <button
                key={m.id}
                onClick={() => setView({ type: "machine", machineId: m.id })}
                className="w-full rounded-2xl border border-border bg-card p-4 text-left hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      <span className="text-primary font-mono text-xs mr-1.5">{m.code}</span>
                      {m.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {m.departmentName}{m.location ? ` · ${m.location}` : ""} · {m.ownerName ? `owner: ${m.ownerName}` : "unassigned"}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {m.components.slice(0, 6).map((c) => (
                      <span key={c.id} className={`h-2.5 w-2.5 rounded-full ${STATUS_META[c.currentStatus].dot}`} title={c.name} />
                    ))}
                    {m.components.length > 6 && <span className="text-[9px] text-muted-foreground">+{m.components.length - 6}</span>}
                  </div>
                  <span className={`text-[10px] font-bold flex items-center gap-1 ${complete ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {complete ? <CheckCircle2 className="h-3 w-3" /> : <Radar className="h-3 w-3" />}
                    {p.done}/{p.total} today
                  </span>
                </div>
                {p.attention > 0 && (
                  <p className="mt-2 text-[10px] font-semibold text-amber-400">{p.attention} component{p.attention > 1 ? "s" : ""} flagged for the Engineer</p>
                )}
              </button>
            );
          })}
        </div>
        )}

        {/* Status picker + history — mounted in the list branch too, so register lines
            open the log sheet directly without detouring through machine detail */}
        <StatusPickerSheet
          key={picked?.id ?? "none"}
          component={picked}
          machineCode={pickedMachine?.code ?? ""}
          canReport={true}
          onClose={() => {
            setPicked(null);
            setPickedMachine(null);
          }}
          onSaved={refresh}
          onOpenHistory={(comp) => setHistory({ comp, logs: [] })}
        />
        <ComponentHistorySheet
          component={history.comp}
          machineCode={pickedMachine?.code ?? ""}
          onClose={() => setHistory({ comp: null, logs: [] })}
        />
      </div>
    );
  }

  // ---------- Machine detail ----------
  // (Unreachable in practice — the two guards above returned for every other case.)
  if (!machine) return null;
  const canEditMachine = isAdmin || machine.ownerId === data.user.id;
  // The whole plant reports here: every machine, valve, instrument and component is
  // on everyone's round, so the Engineer can direct any artisan anywhere. The log
  // still stamps who reported and how far they stood from the tag.
  const canReport = true;
  const doneCount = machine.components.filter((c) => c.reportedToday).length;
  const grouped = machine.components.reduce<Record<string, ComponentDTO[]>>((acc, c) => {
    const key = c.category ?? "Other";
    (acc[key] = acc[key] ?? []).push(c);
    return acc;
  }, {});

  const addComponent = async () => {
    if (!newComp.name.trim()) {
      toast.error("Component name is required");
      return;
    }
    try {
      const created = await createComponent({ machineId: machine.id, name: newComp.name, partCode: newComp.partCode || undefined, category: newComp.category || undefined });
      toast.success(`${newComp.name} added to ${machine.code}`, {
        description: `Part code ${created.partCode ?? newComp.partCode} · the Engineer sees it on their dashboard now`,
      });
      setNewComp({ name: "", partCode: suggestComponentPartCode(data.machines), category: "" });
      setPartTouched(false);
      setAddOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add component");
    }
  };

  return (
    <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
      <button onClick={() => setView({ type: "list" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" /> All machines
      </button>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h1 className="text-base font-bold">
          <span className="text-primary font-mono text-xs mr-1.5">{machine.code}</span>
          {machine.name}
        </h1>
        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
          <MapPin className="h-3 w-3" /> {machine.departmentName}{machine.location ? ` · ${machine.location}` : ""}
          <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {pmCycleLabel(machine.pmCycle, machine.pmDay)}</span>
        </p>
        <div className="mt-3 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Round progress today</span>
          <span className={doneCount === machine.components.length && machine.components.length > 0 ? "text-emerald-400 font-bold" : "font-bold"}>
            {doneCount}/{machine.components.length}
          </span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${doneCount === machine.components.length && machine.components.length > 0 ? "bg-emerald-500" : "bg-primary"}`}
            style={{ width: `${machine.components.length ? (doneCount / machine.components.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* PM history + printable status log — the machine's full paper trail */}
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => setPmOpen(true)}
          className="rounded-2xl border border-border bg-card p-4 text-left hover:bg-accent/40 transition-colors flex items-center gap-3"
        >
          <span className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <History className="h-4.5 w-4.5 text-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold">PM history &amp; execution record</span>
            <span className="block text-[10px] text-muted-foreground">Every PM carried on {machine.code} · who took it · printed WO reports</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
        <button
          onClick={() => setPrintOpen(true)}
          className="rounded-2xl border border-border bg-card p-4 text-left hover:bg-accent/40 transition-colors flex items-center gap-3"
        >
          <span className="h-9 w-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <FileText className="h-4.5 w-4.5 text-emerald-400" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold">Print status log report</span>
            <span className="block text-[10px] text-muted-foreground">Every state entry on {machine.code} for the last 7 days · company letterhead</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </div>

      {canEditMachine && (
        <button
          onClick={() => setAddOpen((v) => !v)}
          className="w-full h-10 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add sub-component to {machine.code}
        </button>
      )}

      {addOpen && canEditMachine && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <input ref={compNameRef} value={newComp.name} onChange={(e) => setNewComp({ ...newComp, name: e.target.value })} placeholder="Component name (e.g. Drive Motor)" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_COMPONENTS.map((q) => (
              <button key={q.name} type="button" onClick={() => setNewComp((s) => ({ ...s, name: q.name, category: q.category }))}
                className="h-7 px-2.5 rounded-full border border-border bg-secondary/60 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                {q.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <input value={newComp.partCode} onChange={(e) => { setNewComp({ ...newComp, partCode: e.target.value.toUpperCase() }); setPartTouched(true); }} placeholder="Auto code (editable)" className="w-full h-10 rounded-lg bg-background border border-input pl-3 pr-9 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/50" />
              <button type="button" onClick={regenPartCode} title="Generate a fresh code"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md bg-secondary border border-border flex items-center justify-center hover:bg-accent">
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            <input value={newComp.category} onChange={(e) => setNewComp({ ...newComp, category: e.target.value })} placeholder="Category" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <button onClick={addComponent} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-bold">Save component</button>
        </div>
      )}

      {machine.components.length === 0 ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
          <p className="text-xs font-bold text-primary">No sub-components yet</p>
          <p className="text-[10.5px] text-muted-foreground mt-1">Add the first one above — e.g. Mechanical Seal, Drive Motor, Flow Transmitter. Everything you add is seen by the Engineer on their dashboard too.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, comps]) => (
          <div key={cat}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 mt-1">{cat}</p>
            <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
              {comps.map((c) => {
                const meta = STATUS_META[c.currentStatus];
                return (
                  <button
                    key={c.id}
                    onClick={() => setPicked(c)}
                    className="w-full px-3.5 py-3 flex items-center justify-between gap-2 hover:bg-accent/40 transition-colors text-left"
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${meta.dot}`} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold truncate">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {c.partCode ? `${c.partCode} · ` : ""}
                          {c.reportedToday ? "reported today ✓" : c.lastLog ? `last ${new Date(c.lastLog.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "never reported"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {meta.alert && <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" title="Engineer alerted" />}
                      <StatusBadge status={c.currentStatus} size="xs" />
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Legend */}
      <div className="rounded-xl border border-border bg-card/60 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Quick guide</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><Wrench className="h-3 w-3 text-cyan-400" /> Maintenance · someone is on it</span>
          <span className="flex items-center gap-1.5"><PackageOpen className="h-3 w-3 text-fuchsia-400" /> Spares · waiting for parts</span>
          <span className="flex items-center gap-1.5"><Lock className="h-3 w-3 text-yellow-400" /> LOTO · locked & tagged</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> Red dot = Engineer alerted</span>
        </div>
      </div>

      {/* Status picker — opened from the register (pickedMachine) or from machine detail */}
      <StatusPickerSheet
        key={picked?.id ?? "none"}
        component={picked}
        machineCode={(pickedMachine ?? machine).code}
        canReport={canReport}
        onClose={() => {
          setPicked(null);
          setPickedMachine(null);
        }}
        onSaved={refresh}
        onOpenHistory={(comp) => setHistory({ comp, logs: [] })}
      />

      {/* Printable status log report */}
      {printOpen && (
        <MachineStatusReport
          machineId={machine.id}
          machineCode={machine.code}
          onClose={() => setPrintOpen(false)}
        />
      )}

      <ComponentHistorySheet
        component={history.comp}
        machineCode={machine.code}
        onClose={() => setHistory({ comp: null, logs: [] })}
      />

      {/* PM history sheet */}
      {pmOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={() => setPmOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 top-10 md:top-14 rounded-t-3xl border-t border-border bg-background overflow-y-auto brewops-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-4 py-3">
              <p className="text-sm font-bold flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> {machine.code} · PM history
              </p>
              <button onClick={() => setPmOpen(false)} aria-label="Close PM history" className="h-8 w-8 rounded-lg bg-secondary border border-border flex items-center justify-center hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 md:p-6 md:max-w-3xl">
              <PmHistoryPanel key={machine.id} machineId={machine.id} machineCode={machine.code} data={data} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
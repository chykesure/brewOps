"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BootstrapData, ComponentDTO, MachineDTO } from "@/lib/types";
import { createMachine, createComponent, patchMachine, patchPart } from "@/lib/client-api";
import { StatusBadge } from "@/components/brewops/status-badge";
import StatusPickerSheet from "@/components/brewops/status-picker-sheet";
import ComponentHistorySheet from "@/components/brewops/component-history-sheet";
import PmHistoryPanel from "@/components/brewops/pm-history-panel";
import MachineTag from "@/components/brewops/machine-tag";
import AssetsImport from "@/components/brewops/assets-import";
import { STATUS_META, pmCycleLabel, fmtDistance } from "@/lib/status";
import { suggestMachineCode, suggestComponentPartCode } from "@/lib/machine-code";
import { getPosition } from "@/lib/client-geo";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Search, Plus, PackageOpen, Wrench, Timer,
  Minus, UserRound, CalendarClock, Boxes, LoaderCircle,
  QrCode, MapPin, Upload, LocateFixed, ShieldCheck, Keyboard, RefreshCw,
} from "lucide-react";

type Mode =
  | { type: "list" }
  | { type: "machine"; machineId: string; focusComp?: boolean }
  | { type: "parts" };

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

export default function AdminMachines({ data, refresh }: { data: BootstrapData; refresh: () => void }) {
  const [mode, setMode] = useState<Mode>({ type: "list" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ComponentDTO | null>(null);
  const [historyComp, setHistoryComp] = useState<ComponentDTO | null>(null);
  const [machineCode, setMachineCode] = useState("");
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  // Auto-generated machine code — stays editable; any manual keystroke marks it "touched"
  // so we stop re-suggesting over the Engineer's own text.
  const [codeTouched, setCodeTouched] = useState(false);
  const compNameRef = useRef<HTMLInputElement | null>(null);

  // new machine form
  const [nm, setNm] = useState({ code: "", name: "", departmentId: "", location: "", ownerId: "", pmCycle: "WEEKLY", pmDay: 1 });
  // new component form
  const [nc, setNc] = useState({ name: "", partCode: "", category: "" });
  // Auto part code — editable; a manual keystroke marks it "touched" so we stop
  // re-suggesting over the Engineer's own text.
  const [partTouched, setPartTouched] = useState(false);

  const machine = mode.type === "machine" ? data.machines.find((m) => m.id === mode.machineId) : null;

  const depts = useMemo(() => {
    const set = new Map<string, string>();
    data.machines.forEach((m) => set.set(m.departmentId, m.departmentName));
    return Array.from(set.entries());
  }, [data.machines]);

  const deptName = (id: string) => depts.find(([did]) => did === id)?.[1] ?? null;
  const regenCode = (departmentId?: string) => {
    setNm((s) => ({ ...s, code: suggestMachineCode(deptName(departmentId ?? s.departmentId), data.machines) }));
    setCodeTouched(false);
  };

  // When the register panel opens, hand the Engineer a fresh code straight away
  const openAddMachine = () => {
    const opening = !addMachineOpen;
    setAddMachineOpen(opening);
    if (opening && !codeTouched) {
      setNm((s) => ({ ...s, code: s.code.trim() ? s.code : suggestMachineCode(null, data.machines) }));
    }
  };

  // After registering, the Registry jumps into the new machine so the Engineer
  // can wire up its sub-components immediately (form is auto-focused).
  useEffect(() => {
    if (mode.type === "machine" && mode.focusComp) {
      const t = setTimeout(() => compNameRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [mode]);

  // Opening a machine hands the Engineer a fresh letters+numbers part code
  // (CP-7K3M style) for the next sub-component — the code input never blocks.
  const openMachineId = mode.type === "machine" ? mode.machineId : null;
  useEffect(() => {
    if (!openMachineId) return;
    setPartTouched(false);
    setNc((s) => ({ ...s, partCode: s.partCode.trim() ? s.partCode : suggestComponentPartCode(data.machines) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMachineId]);

  const regenPartCode = () => {
    setPartTouched(false);
    setNc((s) => ({ ...s, partCode: suggestComponentPartCode(data.machines) }));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.machines;
    return data.machines.filter(
      (m) =>
        `${m.code} ${m.name} ${m.departmentName} ${m.ownerName ?? ""} ${m.functionalLoc ?? ""} ${m.equipmentNo ?? ""}`
          .toLowerCase()
          .includes(q) || m.components.some((c) => `${c.name} ${c.partCode ?? ""}`.toLowerCase().includes(q)),
    );
  }, [data.machines, query]);

  const openMachine = (m: MachineDTO) => {
    setMachineCode(m.code);
    setMode({ type: "machine", machineId: m.id });
  };

  const saveMachine = async () => {
    if (!nm.name.trim() || !nm.departmentId) {
      toast.error("Name and department are required");
      return;
    }
    setBusy(true);
    try {
      const created = await createMachine({
        code: nm.code.trim() || undefined, name: nm.name, departmentId: nm.departmentId,
        location: nm.location || undefined, ownerId: nm.ownerId || undefined,
        pmCycle: nm.pmCycle, pmDay: Number(nm.pmDay),
      });
      toast.success(`${created.code} registered`, {
        description: "Now add its sub-components — motors, seals, sensors…",
      });
      setAddMachineOpen(false);
      setNm({ code: "", name: "", departmentId: "", location: "", ownerId: "", pmCycle: "WEEKLY", pmDay: 1 });
      setCodeTouched(false);
      refresh();
      setMode({ type: "machine", machineId: created.id, focusComp: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not register machine");
    } finally {
      setBusy(false);
    }
  };

  const saveComponent = async () => {
    if (!machine || !nc.name.trim()) {
      toast.error("Component name is required");
      return;
    }
    setBusy(true);
    try {
      const created = await createComponent({ machineId: machine.id, name: nc.name, partCode: nc.partCode || undefined, category: nc.category || undefined });
      toast.success(`${nc.name} added to ${machine.code}`, {
        description: `Part code ${created.partCode ?? nc.partCode} · visible on the Engineer and Artisan dashboards now`,
      });
      setNc({ name: "", partCode: suggestComponentPartCode(data.machines), category: "" });
      setPartTouched(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add component");
    } finally {
      setBusy(false);
    }
  };

  const saveMachineConfig = async (
    cfg: { ownerId: string | null; pmCycle: string; pmDay: number; lat: number | null; lng: number | null; geoRadiusM: number; checkinCode?: string },
  ) => {
    if (!machine) return;
    setBusy(true);
    try {
      await patchMachine(machine.id, {
        ownerId: cfg.ownerId, pmCycle: cfg.pmCycle, pmDay: cfg.pmDay,
        lat: cfg.lat, lng: cfg.lng, geoRadiusM: cfg.geoRadiusM,
        ...(cfg.checkinCode ? { checkinCode: cfg.checkinCode } : {}),
      });
      toast.success(`${machine.code} updated`);
      setEditOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  // Engineer stands at the machine and captures the tag position for the geofence
  const captureGps = async (m: MachineDTO) => {
    setLocating(true);
    try {
      const fix = await getPosition(true);
      if (!fix) { toast.error("No GPS fix. Enable location permissions and try again"); return; }
      await patchMachine(m.id, { lat: fix.lat, lng: fix.lng });
      toast.success(`${m.code} position captured (±${fix.acc ? Math.round(fix.acc) : "?"} m)`, {
        description: `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} · artisans must check in within the geofence`,
      });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setLocating(false);
    }
  };

  const adjustStock = async (id: string, delta: number) => {
    try {
      await patchPart(id, { delta });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stock update failed");
    }
  };

  // ---------- Parts ----------
  if (mode.type === "parts") {
    return (
      <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
        <button onClick={() => setMode({ type: "list" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Registry
        </button>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Spare Parts</h1>
          <p className="text-xs text-muted-foreground">Live stock. Artisans see this before starting a job so nobody walks to the store twice.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
          {data.parts.map((p) => {
            const low = p.stock <= p.reorderLevel;
            return (
              <div key={p.id} className="px-3.5 py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold truncate">{p.code} · {p.name}</p>
                  <p className={`text-[10px] font-semibold ${low ? "text-red-400" : "text-emerald-400"}`}>
                    {low ? (p.stock === 0 ? "OUT OF STOCK · reorder now" : "Low · below reorder level") : "In stock"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => adjustStock(p.id, -1)} className="h-8 w-8 rounded-lg bg-secondary border border-border flex items-center justify-center hover:bg-accent" aria-label="Decrease stock">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className={`w-10 text-center text-sm font-bold ${low ? "text-red-400" : ""}`}>{p.stock}</span>
                  <button onClick={() => adjustStock(p.id, 1)} className="h-8 w-8 rounded-lg bg-secondary border border-border flex items-center justify-center hover:bg-accent" aria-label="Increase stock">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- Machine detail ----------
  // Registered a moment ago and the fresh bootstrap hasn't landed yet — show a
  // loading card instead of flashing back to the list.
  if (mode.type === "machine" && !machine) {
    return (
      <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
        <button onClick={() => setMode({ type: "list" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Registry
        </button>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <LoaderCircle className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground mt-2">Opening the new machine…</p>
        </div>
      </div>
    );
  }

  if (mode.type === "machine" && machine) {
    const grouped = machine.components.reduce<Record<string, ComponentDTO[]>>((acc, c) => {
      const key = c.category ?? "Other";
      (acc[key] = acc[key] ?? []).push(c);
      return acc;
    }, {});
    const downCount = machine.components.filter((c) => STATUS_META[c.currentStatus].alert).length;

    return (
      <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
        <button onClick={() => setMode({ type: "list" })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Registry
        </button>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-base font-bold"><span className="text-primary font-mono text-xs mr-1.5">{machine.code}</span>{machine.name}</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">{machine.departmentName}{machine.location ? ` · ${machine.location}` : ""}</p>
              {(machine.functionalLoc || machine.equipmentNo) && (
                <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">{machine.functionalLoc ?? ""}{machine.functionalLoc && machine.equipmentNo ? " · " : ""}{machine.equipmentNo ? `EQ-${machine.equipmentNo}` : ""}</p>
              )}
            </div>
            <button onClick={() => setEditOpen(true)} className="h-8 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold hover:bg-accent">
              Edit
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <p className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="h-3.5 w-3.5" /> {machine.ownerName ?? "No owner"}</p>
            <p className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" /> {pmCycleLabel(machine.pmCycle, machine.pmDay)}</p>
            <p className="flex items-center gap-1.5 text-muted-foreground"><Boxes className="h-3.5 w-3.5" /> {machine.components.length} components</p>
            {downCount > 0 && <p className="flex items-center gap-1.5 text-amber-400 font-semibold"><Wrench className="h-3.5 w-3.5" /> {downCount} flagged</p>}
          </div>

          {/* ---- Check-in tag & geofence ---- */}
          <div className="mt-3 rounded-xl border border-border bg-background/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] font-bold flex items-center gap-1.5">
                {machine.lat != null
                  ? <><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Geofence armed · ±{machine.geoRadiusM} m</>
                  : <><MapPin className="h-3.5 w-3.5 text-amber-400" /> No GPS position yet</>}
              </p>
              {machine.checkinCode && <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-primary">NAMEPLATE {machine.checkinCode}</span>}
            </div>
            {machine.lat != null && (
              <p className="text-[10px] text-muted-foreground font-mono">{machine.lat.toFixed(5)}, {machine.lng?.toFixed(5)} · check-ins beyond {fmtDistance(machine.geoRadiusM)} are flagged</p>
            )}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => captureGps(machine)} disabled={locating || busy}
                className="h-9 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold flex items-center gap-1.5 hover:bg-accent disabled:opacity-50">
                {locating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
                {machine.lat != null ? "Re-capture position" : "Capture position here"}
              </button>
              <button onClick={() => setTagOpen(true)} disabled={!machine.checkinCode}
                className="h-9 px-3 rounded-lg bg-primary/10 border border-primary/40 text-primary text-[11px] font-bold flex items-center gap-1.5 hover:bg-primary/20 disabled:opacity-40">
                <QrCode className="h-3.5 w-3.5" /> Print QR sticker (optional)
              </button>
            </div>
            {machine.lat == null ? (
              <p className="text-[10px] text-muted-foreground">Stand at the machine and <b className="text-foreground">Capture position here</b> once. After that artisans check in by GPS with nothing to print. The nameplate number is the fallback when GPS can&apos;t get a fix.</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">Artisans check in by GPS (no printing needed) or by typing the nameplate number when GPS is weak indoors.</p>
            )}
          </div>
        </div>

        {/* Add component — auto part code + one-tap common sub-components */}
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Add sub-component under {machine.code}</p>
          <input ref={compNameRef} value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="Name (e.g. Mechanical Seal)" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_COMPONENTS.map((q) => (
              <button key={q.name} type="button" onClick={() => setNc((s) => ({ ...s, name: q.name, category: q.category }))}
                className="h-7 px-2.5 rounded-full border border-border bg-secondary/60 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                {q.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <input value={nc.partCode} onChange={(e) => { setNc({ ...nc, partCode: e.target.value.toUpperCase() }); setPartTouched(true); }} placeholder="Auto code (editable)" className="w-full h-10 rounded-lg bg-background border border-input pl-3 pr-9 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/50" />
              <button type="button" onClick={regenPartCode} title="Generate a fresh code"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md bg-secondary border border-border flex items-center justify-center hover:bg-accent">
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            <input value={nc.category} onChange={(e) => setNc({ ...nc, category: e.target.value })} placeholder="Category" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <button onClick={saveComponent} disabled={busy} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Add to {machine.code}
          </button>
        </div>

        {machine.components.length === 0 ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
            <p className="text-xs font-bold text-primary">No sub-components yet</p>
            <p className="text-[10.5px] text-muted-foreground mt-1">Add the first one above — e.g. Mechanical Seal, Drive Motor, Flow Transmitter. Every component you add appears on both dashboards and in the daily round.</p>
          </div>
        ) : (
          Object.entries(grouped).map(([cat, comps]) => (
            <div key={cat}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 mt-1">{cat}</p>
              <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
                {comps.map((c) => (
                  <button key={c.id} onClick={() => setPicked(c)} className="w-full px-3.5 py-3 flex items-center justify-between gap-2 hover:bg-accent/40 transition-colors text-left">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_META[c.currentStatus].dot}`} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold truncate">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground">{c.partCode ? `${c.partCode} · ` : ""}updated {new Date(c.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusBadge status={c.currentStatus} size="xs" />
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}

        {/* PM history — every PM carried on this machine + the artisans who took them */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 mt-1">PM history &amp; execution record</p>
          <PmHistoryPanel key={machine.id} machineId={machine.id} machineCode={machine.code} data={data} />
        </div>

        {/* Downtime history */}
        {data.downtimes.filter((d) => d.machineId === machine.id).length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 mt-1">Downtime log</p>
            <div className="space-y-1.5">
              {data.downtimes.filter((d) => d.machineId === machine.id).map((d) => (
                <div key={d.id} className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold flex items-center gap-1.5"><Timer className="h-3 w-3 text-red-400" /> DOWN since {new Date(d.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{d.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <StatusPickerSheet
          key={picked?.id ?? "none"}
          component={picked}
          machineCode={machine.code}
          canReport
          onClose={() => setPicked(null)}
          onSaved={refresh}
          onOpenHistory={(comp) => { setPicked(null); setHistoryComp(comp); }}
        />
        <ComponentHistorySheet component={historyComp} machineCode={machineCode} onClose={() => setHistoryComp(null)} />

        {/* Edit machine sheet */}
        {editOpen && (
          <MachineEditSheet
            machine={machine}
            artisans={data.artisans.map((a) => ({ id: a.id, name: a.name }))}
            busy={busy}
            onClose={() => setEditOpen(false)}
            onSave={saveMachineConfig}
          />
        )}
        {tagOpen && (
          <MachineTag machine={machine} onClose={() => setTagOpen(false)} onChanged={refresh} />
        )}
      </div>
    );
  }

  // ---------- Machine list ----------
  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Asset Registry</h1>
          <p className="text-xs text-muted-foreground">{data.machines.length} machines · {data.machines.reduce((n, m) => n + m.components.length, 0)} components</p>
        </div>
        <button
          onClick={() => setMode({ type: "parts" })}
          className="h-9 px-3 rounded-xl bg-secondary border border-border text-xs font-semibold flex items-center gap-1.5 hover:bg-accent"
        >
          <PackageOpen className="h-3.5 w-3.5" /> Spares
          {data.stats.lowStockCount > 0 && <span className="h-2 w-2 rounded-full bg-red-500" />}
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code, name, owner, component…"
          className="w-full h-11 rounded-xl bg-card border border-input pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <button
        onClick={openAddMachine}
        className="w-full h-11 rounded-xl border border-primary/40 bg-primary/5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors flex items-center justify-center gap-1.5"
      >
        <Plus className="h-4 w-4" /> Register new machine
      </button>

      {/* Bulk loading — real plant equipment arrives via CSV */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setImportOpen(true)}
          className="flex-1 min-w-[140px] h-11 rounded-xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-cyan-500/20 transition-colors"
        >
          <Upload className="h-4 w-4" /> Bulk import equipment (CSV)
        </button>
        <a
          href="/api/assets/export"
          className="flex-1 min-w-[140px] h-11 rounded-xl border border-border bg-card text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-accent transition-colors"
        >
          <PackageOpen className="h-4 w-4" /> Export asset register
        </a>
      </div>

      {addMachineOpen && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2 md:max-w-3xl">
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <input value={nm.code} onChange={(e) => { setNm({ ...nm, code: e.target.value }); setCodeTouched(true); }} placeholder="Auto code (editable)" className="w-full h-10 rounded-lg bg-background border border-input pl-3 pr-9 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/50" />
              <button type="button" onClick={() => regenCode()} title="Generate a fresh code"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md bg-secondary border border-border flex items-center justify-center hover:bg-accent">
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            <input value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} placeholder="Machine name" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={nm.departmentId} onChange={(e) => { const v = e.target.value; if (!codeTouched) regenCode(v); setNm((s) => ({ ...s, departmentId: v })); }} className="w-full h-10 rounded-lg bg-background border border-input px-2 text-sm outline-none">
              <option value="">Department…</option>
              {depts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={nm.ownerId} onChange={(e) => setNm({ ...nm, ownerId: e.target.value })} className="w-full h-10 rounded-lg bg-background border border-input px-2 text-sm outline-none">
              <option value="">Owner (artisan)…</option>
              {data.artisans.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={nm.pmCycle} onChange={(e) => setNm({ ...nm, pmCycle: e.target.value })} className="w-full h-10 rounded-lg bg-background border border-input px-2 text-sm outline-none">
              {["NONE", "DAILY", "WEEKLY", "MONTHLY"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" min={1} max={31} value={nm.pmDay} onChange={(e) => setNm({ ...nm, pmDay: Number(e.target.value) })} placeholder="PM day" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none" />
          </div>
          <input value={nm.location} onChange={(e) => setNm({ ...nm, location: e.target.value })} placeholder="Location (optional)" className="w-full h-10 rounded-lg bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
          <button onClick={saveMachine} disabled={busy} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Register machine
          </button>
          <p className="text-[10px] text-muted-foreground">PM day: weekday 1=Mon…7=Sun for WEEKLY · day-of-month 1–31 for MONTHLY.</p>
        </div>
      )}

      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 md:items-start">
        {filtered.map((m) => {
          const alerts = m.components.filter((c) => STATUS_META[c.currentStatus].alert).length;
          return (
            <button key={m.id} onClick={() => openMachine(m)} className="w-full rounded-2xl border border-border bg-card p-4 text-left hover:bg-accent/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold"><span className="text-primary font-mono text-xs mr-1.5">{m.code}</span>{m.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{m.departmentName} · {m.ownerName ?? "unassigned"} · {m.components.length} comps</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
              </div>
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                {m.components.slice(0, 8).map((c) => (
                  <span key={c.id} className={`h-2.5 w-2.5 rounded-full ${STATUS_META[c.currentStatus].dot}`} title={c.name} />
                ))}
                {m.components.length > 8 && <span className="text-[9px] text-muted-foreground">+{m.components.length - 8}</span>}
                {alerts > 0 && <span className="ml-auto text-[10px] font-bold text-amber-400">{alerts} flagged</span>}
                {m.lat != null && <MapPin className="h-3 w-3 text-emerald-400" aria-label="Geofence armed" />}
                {m.checkinCode && <Keyboard className="h-3 w-3 text-primary" aria-label="Nameplate registered" />}
              </div>
            </button>
          );
        })}
      </div>

      {importOpen && (
        <AssetsImport onClose={() => setImportOpen(false)} onImported={refresh} />
      )}
    </div>
  );
}

function MachineEditSheet({
  machine, artisans, busy, onClose, onSave,
}: {
  machine: MachineDTO;
  artisans: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (cfg: { ownerId: string | null; pmCycle: string; pmDay: number; lat: number | null; lng: number | null; geoRadiusM: number; checkinCode?: string }) => void;
}) {
  const [ownerId, setOwnerId] = useState(machine.ownerId ?? "");
  const [pmCycle, setPmCycle] = useState<string>(machine.pmCycle);
  const [pmDay, setPmDay] = useState(machine.pmDay);
  const [lat, setLat] = useState(machine.lat != null ? String(machine.lat) : "");
  const [lng, setLng] = useState(machine.lng != null ? String(machine.lng) : "");
  const [radius, setRadius] = useState(machine.geoRadiusM ?? 150);
  const [npCode, setNpCode] = useState(machine.checkinCode ?? "");

  const parseNum = (v: string): number | null => {
    if (!v.trim()) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  // Suggest the tail of the machine's real equipment/serial number as the nameplate code
  const eqTail = machine.equipmentNo
    ? machine.equipmentNo.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-6)
    : "";
  const npChanged = npCode.trim() !== (machine.checkinCode ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Edit ${machine.code}`}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[88vh] overflow-y-auto brewops-scroll shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold">Edit {machine.code} {machine.name}</p>
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Assigned artisan (named ownership)</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full h-11 rounded-xl bg-background border border-input px-2 text-sm outline-none">
            <option value="">Unassigned</option>
            {artisans.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PM cycle</label>
              <select value={pmCycle} onChange={(e) => setPmCycle(e.target.value)} className="w-full h-11 rounded-xl bg-background border border-input px-2 text-sm outline-none">
                {["NONE", "DAILY", "WEEKLY", "MONTHLY"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PM day</label>
              <input type="number" min={1} max={31} value={pmDay} onChange={(e) => setPmDay(Number(e.target.value))} className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">WEEKLY: 1=Mon … 7=Sun · MONTHLY: 1–31.</p>

          <div className="rounded-xl border border-border bg-background/60 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Check-in geofence</p>
            <div className="grid grid-cols-3 gap-2">
              <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="lat" inputMode="decimal"
                className="h-10 rounded-lg bg-background border border-input px-2 text-xs outline-none font-mono" />
              <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="lng" inputMode="decimal"
                className="h-10 rounded-lg bg-background border border-input px-2 text-xs outline-none font-mono" />
              <input type="number" min={30} max={2000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} placeholder="radius m"
                className="h-10 rounded-lg bg-background border border-input px-2 text-xs outline-none" />
            </div>
            <p className="text-[10px] text-muted-foreground">Leave lat/lng empty to clear. Artisans check in by GPS (nothing to print); the nameplate number is the fallback when GPS can&apos;t get a fix.</p>
          </div>

          <div className="rounded-xl border border-border bg-background/60 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Keyboard className="h-3.5 w-3.5" /> Nameplate check-in code</p>
            <div className="flex gap-2">
              <input
                value={npCode}
                onChange={(e) => setNpCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                placeholder="e.g. 4471203"
                className="flex-1 h-10 rounded-lg bg-background border border-input px-3 text-sm font-mono font-bold tracking-[0.15em] uppercase outline-none focus:ring-2 focus:ring-primary/50"
              />
              {eqTail && (
                <button type="button" onClick={() => setNpCode(eqTail)} disabled={eqTail.length < 4}
                  className="h-10 px-3 rounded-lg bg-secondary border border-border text-[11px] font-semibold flex items-center gap-1.5 hover:bg-accent disabled:opacity-40"
                  title={`Use the tail of equipment no. ${machine.equipmentNo}`}>
                  Use EQ no.
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              The number artisans type at check-in when GPS is weak. Best choice: the serial on the machine&apos;s own metal nameplate (zero printing), or tap “Use EQ no.” to take the last 6 characters of the equipment number.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            onClick={() => onSave({ ownerId: ownerId || null, pmCycle, pmDay, lat: parseNum(lat), lng: parseNum(lng), geoRadiusM: radius, ...(npChanged && npCode.trim().length >= 4 ? { checkinCode: npCode.trim() } : {}) })}
            disabled={busy}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
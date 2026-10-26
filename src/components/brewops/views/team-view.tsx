"use client";

import { useMemo, useState } from "react";
import type { BootstrapData } from "@/lib/types";
import { createArtisan, patchUser } from "@/lib/client-api";
import { tradeMeta } from "@/lib/status";
import { Avatar } from "@/components/brewops/avatar";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Plus, LoaderCircle, Wrench, Zap, UserRound,
  ShieldCheck, Ban, RotateCcw, UsersRound, Mail, Clock,
} from "lucide-react";

type Member = BootstrapData["team"][number];

const TRADE_OPTIONS = [
  { id: "MECHANICAL", label: "Mechanical", code: "B-MA", icon: Wrench, note: "Pumps, gearboxes, valves, seals, drives" },
  { id: "ELECTRICAL", label: "Electrical", code: "B-EA", icon: Zap, note: "Motors, panels, sensors, wiring, instruments" },
] as const;

export default function TeamView({ data, refresh }: { data: BootstrapData; refresh: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", email: "", pin: "", trade: "", shift: "A", departmentId: "" });
  const [editForm, setEditForm] = useState({ name: "", trade: "", shift: "A", departmentId: "" });
  const [newPin, setNewPin] = useState("");

  const member = openId ? data.team.find((u) => u.id === openId) : null;

  // Department options — derived from the machine registry
  const depts = useMemo(() => {
    const set = new Map<string, string>();
    data.machines.forEach((m) => set.set(m.departmentId, m.departmentName));
    return Array.from(set.entries());
  }, [data.machines]);

  const grouped = useMemo(() => {
    const artisans = data.team.filter((u) => u.role === "ARTISAN");
    return {
      mechanical: artisans.filter((u) => u.trade === "MECHANICAL"),
      electrical: artisans.filter((u) => u.trade === "ELECTRICAL"),
      other: artisans.filter((u) => u.trade !== "MECHANICAL" && u.trade !== "ELECTRICAL"),
      admins: data.team.filter((u) => u.role === "ADMIN"),
    };
  }, [data.team]);

  const create = async () => {
    if (!form.name.trim() || !form.email.trim() || !/^\d{4,6}$/.test(form.pin) || !form.trade) {
      toast.error("Name, email, a 4–6 digit PIN and a trade are required.");
      return;
    }
    setBusy("create");
    try {
      const res = await createArtisan({ ...form });
      toast.success(
        `${res.name} added to the ${form.trade === "ELECTRICAL" ? "Electrical" : "Mechanical"} crew · License ${res.licenseKey ?? "pending"} (inactive until activated)`,
        { duration: 9000 },
      );
      setCreateOpen(false);
      setForm({ name: "", email: "", pin: "", trade: "", shift: "A", departmentId: "" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create artisan");
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, payload: Record<string, unknown>, okMsg: string) => {
    setBusy(id + JSON.stringify(payload).slice(0, 24));
    try {
      await patchUser(id, payload);
      toast.success(okMsg);
      setNewPin("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const openEdit = (m: Member) => {
    setEditForm({ name: m.name, trade: m.trade ?? "", shift: m.shift ?? "A", departmentId: m.departmentId ?? "" });
    setNewPin("");
    setOpenId(m.id);
  };

  // ---------- Member detail ----------
  if (member) {
    const tm = tradeMeta(member.trade);
    const isSelf = member.id === data.user.id;
    return (
      <div className="p-4 md:p-6 md:max-w-3xl space-y-3">
        <button onClick={() => setOpenId(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Team
        </button>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <Avatar name={member.name} avatarUrl={member.avatarUrl} className="h-12 w-12 text-sm" />
            <div className="min-w-0">
              <p className="text-base font-bold leading-tight">{member.name}</p>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Mail className="h-3 w-3" /> {member.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {member.role === "ADMIN"
              ? <span className="rounded-full border border-primary/30 bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-bold flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Brewing Engineer</span>
              : tm && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 ${tm.cls}`}>{member.trade === "ELECTRICAL" ? <Zap className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}{tm.label} Artisan · {tm.code}</span>}
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1"><Clock className="h-3 w-3" /> {member.shift ? `Shift ${member.shift}` : "No shift"}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${member.active ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`}>
              {member.active ? "Active" : "Deactivated"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-xl bg-secondary/50 border border-border p-2.5 text-center">
              <p className="text-lg font-bold leading-none">{member.openWos}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Open work orders</p>
            </div>
            <div className="rounded-xl bg-secondary/50 border border-border p-2.5 text-center">
              <p className="text-lg font-bold leading-none">{member.machines}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Machines owned</p>
            </div>
          </div>
        </div>

        {!isSelf && member.role === "ARTISAN" && (
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Edit artisan</p>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Name</label>
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trade</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {TRADE_OPTIONS.map((t) => {
                  const Icon = t.icon;
                  const active = editForm.trade === t.id;
                  return (
                    <button key={t.id} onClick={() => setEditForm({ ...editForm, trade: t.id })}
                      className={`rounded-xl border p-3 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent/40"}`}>
                      <Icon className={`h-4 w-4 ${t.id === "ELECTRICAL" ? "text-sky-400" : "text-amber-400"}`} />
                      <p className="text-xs font-bold mt-1.5">{t.label}</p>
                      <p className="text-[9px] text-muted-foreground">{t.code}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Shift</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {["A", "B", "C"].map((s) => (
                  <button key={s} onClick={() => setEditForm({ ...editForm, shift: s })}
                    className={`h-10 rounded-xl border text-xs font-bold transition-colors ${editForm.shift === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
                    Shift {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Home department</label>
              <select value={editForm.departmentId} onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })} className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none mt-1">
                <option value="">No department (own machines only)</option>
                {depts.map(([id, dname]) => <option key={id} value={id}>{dname}</option>)}
              </select>
              <p className="text-[9px] text-muted-foreground mt-1">They see and report every machine in this department, not only the ones assigned to them.</p>
            </div>
            <button
              onClick={() => act(member.id, { name: editForm.name, trade: editForm.trade, shift: editForm.shift, departmentId: editForm.departmentId || null }, "Artisan updated")}
              disabled={busy !== null}
              className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy?.startsWith(member.id) ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Save changes
            </button>

            <div className="border-t border-border pt-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reset PIN</label>
              <div className="flex gap-2 mt-1">
                <input
                  value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric" placeholder="New 4–6 digit PIN"
                  className="flex-1 h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  onClick={() => { if (/^\d{4,6}$/.test(newPin)) act(member.id, { resetPin: newPin }, "PIN reset"); else toast.error("PIN must be 4–6 digits."); }}
                  disabled={busy !== null || !/^\d{4,6}$/.test(newPin)}
                  className="h-11 px-4 rounded-xl bg-secondary border border-border text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
              </div>
            </div>

            <button
              onClick={() => act(member.id, { active: !member.active }, member.active ? "Artisan deactivated. They can no longer log in" : "Artisan reactivated")}
              disabled={busy !== null}
              className={`w-full h-11 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${member.active ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"}`}
            >
              {member.active ? <><Ban className="h-3.5 w-3.5" /> Deactivate account</> : <><UserRound className="h-3.5 w-3.5" /> Reactivate account</>}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------- Team list ----------
  const section = (title: string, members: Member[], accentCls: string, icon?: React.ReactNode) => (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">{icon}{title} <span className="font-mono text-[10px]">({members.length})</span></p>
      {members.length === 0 && <p className="text-[11px] text-muted-foreground bg-secondary/40 border border-border rounded-xl px-3 py-2.5">No artisans in this trade yet.</p>}
      {members.map((m) => {
        const tm = tradeMeta(m.trade);
        return (
          <button key={m.id} onClick={() => openEdit(m)} className={`w-full rounded-2xl border p-3.5 text-left transition-colors hover:bg-accent/40 ${m.active ? "border-border bg-card" : "border-border bg-card/50 opacity-60"}`}>
            <div className="flex items-center gap-3">
              <Avatar name={m.name} avatarUrl={m.avatarUrl} className="h-10 w-10 text-[11px]" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold truncate">{m.name}{m.role === "ADMIN" && " · Engineer"}</p>
                <p className="text-[10px] text-muted-foreground truncate">{m.email} · {m.shift ? `Shift ${m.shift}` : "No shift"}</p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                {tm && m.role === "ARTISAN" && <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${tm.cls}`}>{tm.code}</span>}
                {m.role === "ADMIN" && <span className="rounded-full border border-primary/30 bg-primary/15 text-primary px-2 py-0.5 text-[9px] font-bold">ENG</span>}
                <span className="text-[10px] text-muted-foreground">{m.openWos} open · {m.machines} machines</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2"><UsersRound className="h-5 w-5 text-primary" /> Team</h1>
          <p className="text-xs text-muted-foreground">Artisans are categorised into Mechanical and Electrical crews.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-transform"
        >
          <Plus className="h-4 w-4" /> Add Artisan
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        {section("Mechanical Crew", grouped.mechanical, "", <Wrench className="h-3.5 w-3.5 text-amber-400" />)}
        {section("Electrical Crew", grouped.electrical, "", <Zap className="h-3.5 w-3.5 text-sky-400" />)}
        {grouped.other.length > 0 && section("Other Trades", grouped.other, "")}
        {section("Engineering", grouped.admins, "")}
      </div>

      {/* Create artisan sheet */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={() => setCreateOpen(false)}>
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[88vh] overflow-y-auto brewops-scroll" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Add artisan</p>
              <button onClick={() => setCreateOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
            </div>

            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name (e.g. K. Musa)" className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" placeholder="Work email (e.g. musa@brewops.ng)" className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50" />
            <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" placeholder="Login PIN (4–6 digits)" className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none focus:ring-2 focus:ring-primary/50 font-mono tracking-widest" />

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trade</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {TRADE_OPTIONS.map((t) => {
                  const Icon = t.icon;
                  const active = form.trade === t.id;
                  return (
                    <button key={t.id} onClick={() => setForm({ ...form, trade: t.id })}
                      className={`rounded-xl border p-3 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent/40"}`}>
                      <Icon className={`h-5 w-5 ${t.id === "ELECTRICAL" ? "text-sky-400" : "text-amber-400"}`} />
                      <p className="text-sm font-bold mt-1.5">{t.label}</p>
                      <p className="text-[9px] text-muted-foreground leading-snug mt-0.5">{t.note}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Shift</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {["A", "B", "C"].map((s) => (
                  <button key={s} onClick={() => setForm({ ...form, shift: s })}
                    className={`h-10 rounded-xl border text-xs font-bold transition-colors ${form.shift === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
                    Shift {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Home department</label>
              <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className="w-full h-11 rounded-xl bg-background border border-input px-3 text-sm outline-none mt-1">
                <option value="">No department (own machines only)</option>
                {depts.map(([id, dname]) => <option key={id} value={id}>{dname}</option>)}
              </select>
            </div>

            <button onClick={create} disabled={busy !== null} className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {busy === "create" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create artisan account
            </button>
            <p className="text-[10px] text-muted-foreground text-center">The artisan signs in with this email + PIN. PINs are hashed and never stored in plain text.</p>
          </div>
        </div>
      )}
    </div>
  );
}

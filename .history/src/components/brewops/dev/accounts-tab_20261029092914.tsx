"use client";

// Accounts tab — the owner's account desk inside the Developer Console.
// Works with ZERO accounts in the database: mint the first ENGINEER here,
// sign in with it, then register artisans from the console or the Team page.
// Create · edit (name/email/role/trade/shift/active) · reset PIN · delete artisan.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy, KeyRound, LoaderCircle, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2, UserPlus, Users,
} from "lucide-react";
import {
  devAccountCreate, devAccountDelete, devAccountPatch, devAccounts, type DevAccountUser,
} from "@/lib/client-api";
import { SectionCard, fmtWhen } from "./shared";

const TRADES = ["MECHANICAL", "ELECTRICAL"] as const;
const SHIFTS = ["A", "B", "C"] as const;

function RoleChip({ role }: { role: string }) {
  const admin = role === "ADMIN";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${admin ? "border-amber-500/40 bg-amber-500/10 text-amber-500" : "border-primary/40 bg-primary/10 text-primary"}`}>
      {admin ? "ENGINEER" : "ARTISAN"}
    </span>
  );
}

export default function AccountsTab({ onChanged }: { onChanged?: () => void }) {
  const [users, setUsers] = useState<DevAccountUser[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  // create form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"ADMIN" | "ARTISAN">("ADMIN");
  const [trade, setTrade] = useState<string>("MECHANICAL");
  const [shift, setShift] = useState<string>("A");
  const [justCreated, setJustCreated] = useState<{ name: string; email: string; licenseKey: string | null } | null>(null);

  // inline flows
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [delFor, setDelFor] = useState<string | null>(null);
  const [delWord, setDelWord] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const res = await devAccounts();
      setUsers(res.users);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load accounts");
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.name} ${u.email} ${u.trade ?? ""}`.toLowerCase().includes(q));
  }, [users, search]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await devAccountCreate({
        name, email, pin, role,
        trade: role === "ARTISAN" ? trade : undefined,
        shift,
      });
      setJustCreated({ name: res.name, email, licenseKey: res.licenseKey });
      setName(""); setEmail(""); setPin("");
      toast.success(`Account created — ${res.name} can now sign in`);
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: DevAccountUser) => {
    setBusyUser(u.id);
    try {
      await devAccountPatch({ userId: u.id, action: "update", active: !u.active });
      toast.success(!u.active ? `${u.name} reactivated` : `${u.name} deactivated — sign-in blocked`);
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyUser(null);
    }
  };

  const resetPin = async (u: DevAccountUser) => {
    setBusyUser(u.id);
    try {
      await devAccountPatch({ userId: u.id, action: "pin", pin: pinValue });
      toast.success(`PIN reset for ${u.name} — signed out everywhere, sync password = new PIN`);
      setPinFor(null); setPinValue("");
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset the PIN");
    } finally {
      setBusyUser(null);
    }
  };

  const remove = async (u: DevAccountUser) => {
    setBusyUser(u.id);
    try {
      await devAccountDelete({ userId: u.id, confirm: delWord });
      toast.success(`${u.name} deleted`);
      setDelFor(null); setDelWord("");
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the account");
    } finally {
      setBusyUser(null);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed — select it manually");
    }
  };

  const inputCls = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground";

  return (
    <div className="space-y-6">
      {users !== null && users.length === 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm leading-relaxed">
          <p className="font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-500" /> No accounts exist yet — bootstrap here</p>
          <p className="text-muted-foreground mt-1">
            Create the first <span className="font-bold text-amber-500">ENGINEER</span> account below (pick any work email and a PIN you will remember),
            then sign in on the login screen with that email + PIN. Artisans can be added the same way, or from the Team page after you sign in.
          </p>
        </div>
      )}

      {justCreated && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm">
          <p className="font-semibold text-emerald-400">✓ {justCreated.name} is ready to sign in</p>
          <p className="text-muted-foreground mt-1">Email: <span className="font-mono text-foreground">{justCreated.email}</span> · PIN: the one you typed (tell them privately)</p>
          {justCreated.licenseKey && (
            <button onClick={() => void copy(justCreated.licenseKey as string, "License key")} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-mono font-bold text-emerald-400 hover:bg-emerald-500/20 transition-colors">
              {justCreated.licenseKey} <Copy className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <SectionCard icon={UserPlus} title="Create an account" desc="Mints the account instantly — no sign-in needed. The device sync password starts equal to the PIN.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engr. K. Pascal" className={`${inputCls} mt-1`} autoComplete="off" />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Work email (this is the login)</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. pascal@brewops.ng" className={`${inputCls} mt-1`} autoComplete="off" inputMode="email" />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">PIN (4–6 digits)</span>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••" className={`${inputCls} mt-1 font-mono tracking-[0.3em]`} autoComplete="off" inputMode="numeric" />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "ARTISAN")} className={`${inputCls} mt-1`}>
              <option value="ADMIN">ENGINEER — full dashboard</option>
              <option value="ARTISAN">ARTISAN — floor reporting &amp; work orders</option>
            </select>
          </label>
          {role === "ARTISAN" && (
            <>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Trade</span>
                <select value={trade} onChange={(e) => setTrade(e.target.value)} className={`${inputCls} mt-1`}>
                  {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Shift</span>
                <select value={shift} onChange={(e) => setShift(e.target.value)} className={`${inputCls} mt-1`}>
                  {SHIFTS.map((s) => <option key={s} value={s}>SHIFT {s}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        <button
          onClick={() => void create()}
          disabled={busy || name.trim().length < 3 || !email.trim() || pin.length < 4}
          className="mt-4 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity inline-flex items-center gap-2 disabled:opacity-40"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Create account
        </button>
      </SectionCard>

      <SectionCard icon={Users} title="Team accounts" desc="Everyone with a login. Deactivate to instantly block sign-in without deleting history.">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or trade…" className={`${inputCls} pl-9`} />
          </div>
          <button onClick={() => void load()} disabled={busy} className="rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent transition-colors inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="space-y-2">
          {filtered.map((u) => (
            <div key={u.id} className={`rounded-xl border p-3 ${u.active ? "border-border bg-secondary/30" : "border-red-500/30 bg-red-500/5"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-tight flex items-center gap-2 flex-wrap">
                    {u.name} <RoleChip role={u.role} />
                    {!u.active && <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[9px] font-bold text-red-400">DEACTIVATED</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">{u.email}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {u.role === "ARTISAN" ? `${u.trade ?? "no trade"} · shift ${u.shift ?? "A"} · ` : ""}
                    {u.openWos} open WOs · {u.machines} machines · {u.devices} device{u.devices === 1 ? "" : "s"} · {u.liveSessions} live session{u.liveSessions === 1 ? "" : "s"} · joined {fmtWhen(u.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => void toggleActive(u)}
                    disabled={busyUser === u.id}
                    className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-colors disabled:opacity-50 ${u.active ? "border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"}`}
                  >
                    {u.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => { setPinFor(pinFor === u.id ? null : u.id); setPinValue(""); }}
                    className="rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[10px] font-bold hover:bg-accent transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                    disabled={busyUser === u.id}
                  >
                    <RotateCcw className="h-3 w-3" /> Reset PIN
                  </button>
                  {u.role === "ARTISAN" && (
                    <button
                      onClick={() => { setDelFor(delFor === u.id ? null : u.id); setDelWord(""); }}
                      className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/20 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                      disabled={busyUser === u.id}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  )}
                </div>
              </div>

              {pinFor === u.id && (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                  <p className="text-[11px] text-muted-foreground">New 4–6 digit PIN. Their sync password resets to this PIN and they are signed out on every device.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <input value={pinValue} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••" className={`${inputCls} max-w-[140px] font-mono tracking-[0.3em]`} autoComplete="off" inputMode="numeric" />
                    <button onClick={() => void resetPin(u)} disabled={pinValue.length < 4 || busyUser === u.id} className="rounded-lg bg-amber-500 px-3 py-2 text-[10px] font-bold text-black hover:opacity-90 transition-opacity inline-flex items-center gap-1 disabled:opacity-40">
                      <KeyRound className="h-3 w-3" /> Save PIN
                    </button>
                    <button onClick={() => { setPinFor(null); setPinValue(""); }} className="rounded-lg border border-border px-3 py-2 text-[10px] font-bold hover:bg-accent transition-colors">Cancel</button>
                  </div>
                </div>
              )}

              {delFor === u.id && (
                <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
                  <p className="text-[11px] leading-relaxed">
                    <span className="font-bold text-red-400">This removes {u.name} permanently:</span> their created work orders, status logs, check-ins, downtime reports, escalations, trusted devices and sessions.
                    Work orders assigned to them stay — they just become unassigned. Type <span className="font-mono font-bold">DELETE</span> to confirm.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input value={delWord} onChange={(e) => setDelWord(e.target.value)} placeholder="DELETE" className={`${inputCls} max-w-[160px] font-mono`} autoComplete="off" />
                    <button onClick={() => void remove(u)} disabled={delWord !== "DELETE" || busyUser === u.id} className="rounded-lg bg-red-500 px-3 py-2 text-[10px] font-bold text-white hover:opacity-90 transition-opacity inline-flex items-center gap-1 disabled:opacity-40">
                      <Trash2 className="h-3 w-3" /> Delete forever
                    </button>
                    <button onClick={() => { setDelFor(null); setDelWord(""); }} className="rounded-lg border border-border px-3 py-2 text-[10px] font-bold hover:bg-accent transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {users !== null && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {users.length === 0 ? "No accounts yet — create the first one above." : "No account matches that search."}
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
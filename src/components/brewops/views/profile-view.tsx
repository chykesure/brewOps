"use client";

import { useEffect, useRef, useState } from "react";
import type { BootstrapData } from "@/lib/types";
import { runSchedulerNow, logout, changePassword, fetchSecurity, deviceAction, uploadPhoto, patchProfile, patchOrg, createBranch, patchBranch } from "@/lib/client-api";
import type { SecurityOverview } from "@/lib/types";
import { pmCycleLabel, tradeMeta } from "@/lib/status";
import { Avatar } from "@/components/brewops/avatar";
import { toast } from "sonner";
import {
  LogOut, RefreshCw, LoaderCircle, CalendarClock, Smartphone,
  ShieldCheck, Download, UserRound, Camera, KeyRound, MonitorSmartphone,
  Ban, Building2, Upload, History, Fingerprint, CheckCircle2, XCircle,
} from "lucide-react";

const EVENT_LABEL: Record<string, string> = {
  LOGIN_OK: "Signed in",
  LOGIN_FAIL: "Failed sign-in",
  LOGIN_LOCKED: "Sign-in throttled",
  DEVICE_AUTO_APPROVED: "First device trusted",
  DEVICE_SYNCED: "Device synchronized",
  DEVICE_REVOKED: "Device removed",
  PASSWORD_CHANGED: "Password changed",
  LOGOUT: "Signed out",
  LOGOUT_ALL: "Signed out everywhere",
};

export default function ProfileView({ data, onLogout, refresh }: { data: BootstrapData; onLogout: () => void; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const isAdmin = data.user.role === "ADMIN";

  // ---- Security module state ----
  const [security, setSecurity] = useState<SecurityOverview | null>(null);
  const [pwdForm, setPwdForm] = useState({ current: "", next: "", confirm: "" });

  // ---- Profile state ----
  const avatarInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  // ---- Org settings state (admin) ----
  const [orgName, setOrgName] = useState(data.org.name);
  const [newBranch, setNewBranch] = useState({ name: "", location: "" });

  const loadSecurity = () => {
    fetchSecurity().then(setSecurity).catch(() => null);
  };
  useEffect(loadSecurity, []);

  const runScheduler = async () => {
    setBusy("scheduler");
    try {
      const res = await runSchedulerNow();
      if (res.created.length === 0) {
        toast.info(`Scheduler ran · ${res.skipped} machines checked, nothing due right now.`);
      } else {
        toast.success(`${res.created.length} PM work order(s) generated`, {
          description: res.created.map((c) => `${c.code}: ${c.machine}`).join(" · "),
        });
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scheduler failed");
    } finally {
      setBusy(null);
    }
  };

  const exportHistory = () => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    window.location.href = `/api/export?from=${from}&to=${to}`;
  };

  // ---- Avatar upload ----
  const uploadAvatar = async (file: File | null) => {
    if (!file) return;
    setBusy("avatar");
    try {
      const url = await uploadPhoto(file);
      await patchProfile({ avatarUrl: url });
      toast.success("Profile photo updated. It now shows wherever your name appears.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setBusy(null);
    }
  };

  // ---- Password change ----
  const submitPassword = async () => {
    if (!pwdForm.current || !pwdForm.next) {
      toast.error("Fill in your current and the new password.");
      return;
    }
    if (pwdForm.next !== pwdForm.confirm) {
      toast.error("The two new passwords do not match.");
      return;
    }
    setBusy("password");
    try {
      const res = await changePassword(pwdForm.current, pwdForm.next);
      toast.success("Password changed", {
        description: res.othersSignedOut > 0 ? `${res.othersSignedOut} other session(s) signed out for safety.` : "Use it to synchronize new devices.",
      });
      setPwdForm({ current: "", next: "", confirm: "" });
      refresh();
      loadSecurity();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the password");
    } finally {
      setBusy(null);
    }
  };

  // ---- Device management ----
  const actDevice = async (payload: { action: string; deviceId?: string }, okMsg: string) => {
    setBusy(payload.deviceId ?? payload.action);
    try {
      await deviceAction(payload);
      toast.success(okMsg);
      loadSecurity();
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  // ---- Org identity (admin) ----
  const uploadLogo = async (file: File | null) => {
    if (!file) return;
    setBusy("logo");
    try {
      const url = await uploadPhoto(file);
      await patchOrg({ logoUrl: url });
      toast.success("Company logo saved. It now prints on every report.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Logo upload failed");
    } finally {
      setBusy(null);
    }
  };

  const saveOrgName = async () => {
    setBusy("orgname");
    try {
      await patchOrg({ orgName });
      toast.success("Company name saved. Reports will carry it.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the name");
    } finally {
      setBusy(null);
    }
  };

  const addBranch = async () => {
    if (!newBranch.name.trim()) {
      toast.error("Branch name is required.");
      return;
    }
    setBusy("branch");
    try {
      await createBranch(newBranch.name.trim(), newBranch.location.trim() || undefined);
      toast.success(`${newBranch.name.trim()} added. Departments and users can now be attached to it.`);
      setNewBranch({ name: "", location: "" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the branch");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 md:p-6 md:max-w-3xl space-y-4">
      {/* User card with photo upload */}
      <section className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
        <button onClick={() => avatarInput.current?.click()} className="relative shrink-0 group" aria-label="Upload profile photo">
          <Avatar name={data.user.name} avatarUrl={data.user.avatarUrl} className="h-14 w-14 text-base" />
          <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            {busy === "avatar" ? <LoaderCircle className="h-4 w-4 text-white animate-spin" /> : <Camera className="h-4 w-4 text-white" />}
          </span>
        </button>
        <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { uploadAvatar(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <div className="min-w-0">
          <p className="text-base font-bold truncate">{data.user.name}</p>
          <p className="text-xs text-muted-foreground truncate">{data.user.email}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${isAdmin ? "bg-primary/15 text-primary border-primary/30" : "bg-secondary text-secondary-foreground border-border"}`}>
              {isAdmin ? "Brewing Engineer · Admin" : "Artisan"}
            </span>
            {data.user.trade && (() => { const tm = tradeMeta(data.user.trade); return (
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${tm ? tm.cls : "bg-secondary text-secondary-foreground border-border"}`}>
                {tm ? `${tm.label} Artisan` : data.user.trade}
              </span>
            ); })()}
            {data.user.shift && <span className="text-[9px] text-muted-foreground">· Shift {data.user.shift}</span>}
            <span className="text-[9px] text-muted-foreground underline underline-offset-2">tap the photo to change it</span>
          </div>
        </div>
      </section>

      {/* Security module — password, device synchronization, audit trail */}
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Security</h2>
          {data.user.pwdChangedAt === null && (
            <span className="rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 px-2 py-0.5 text-[9px] font-bold flex items-center gap-1">
              <KeyRound className="h-3 w-3" /> still on the initial password · change it now
            </span>
          )}
        </div>

        {/* Password change */}
        <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><KeyRound className="h-3 w-3" /> Change your work password</p>
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            The password is what synchronizes new phones and computers with your account. Your PIN keeps unlocking
            this device instantly. Changing the password signs out every other device.
          </p>
          <div className="grid sm:grid-cols-3 gap-2">
            <input type="password" value={pwdForm.current} onChange={(e) => setPwdForm({ ...pwdForm, current: e.target.value })} placeholder="Current password (or PIN)" autoComplete="current-password" className="h-10 rounded-lg bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
            <input type="password" value={pwdForm.next} onChange={(e) => setPwdForm({ ...pwdForm, next: e.target.value })} placeholder="New password (8+ chars, letters + numbers)" autoComplete="new-password" className="h-10 rounded-lg bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
            <input type="password" value={pwdForm.confirm} onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })} placeholder="Repeat new password" autoComplete="new-password" className="h-10 rounded-lg bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <button onClick={submitPassword} disabled={busy !== null} className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
            {busy === "password" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Save new password
          </button>
        </div>

        {/* Trusted devices */}
        <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <MonitorSmartphone className="h-3 w-3" /> Synchronized devices
          </p>
          {!security ? (
            <p className="text-[11px] text-muted-foreground py-2">Loading your devices…</p>
          ) : (
            <>
              {security.devices.filter((d) => d.approved).length === 0 && (
                <p className="text-[11px] text-muted-foreground">No synchronized devices yet. This browser becomes trusted the first time you sign in with your password.</p>
              )}
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {security.devices.map((d) => (
                  <div key={d.id} className={`px-3 py-2.5 flex items-center justify-between gap-2 ${d.approved ? "" : "opacity-60"}`}>
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className="h-8 w-8 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0">
                        <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold truncate flex items-center gap-1.5">
                          {d.name}
                          {d.isCurrent && <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 px-1.5 py-px text-[8px] font-bold">THIS DEVICE</span>}
                          {!d.approved && <span className="rounded-full bg-secondary border border-border text-muted-foreground px-1.5 py-px text-[8px] font-bold">REMOVED</span>}
                        </p>
                        <p className="text-[9.5px] text-muted-foreground">{d.platform ?? "Unknown"} · last seen {new Date(d.lastSeenAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                    </div>
                    {d.approved && !d.isCurrent && (
                      <button onClick={() => actDevice({ action: "revokeDevice", deviceId: d.id }, `${d.name} removed. Its sessions were signed out.`)} disabled={busy !== null} className="h-8 px-2.5 rounded-lg border border-red-500/40 text-red-400 text-[10px] font-bold flex items-center gap-1 hover:bg-red-500/10 transition-colors shrink-0 disabled:opacity-40">
                        <Ban className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                <p className="text-[9.5px] text-muted-foreground flex items-center gap-1"><Fingerprint className="h-3 w-3" /> {security.sessions.length} active session{security.sessions.length === 1 ? "" : "s"} right now</p>
                <button onClick={() => actDevice({ action: "signOutOthers" }, "Every other device has been signed out.")} disabled={busy !== null || security.sessions.length < 2} className="h-8 px-3 rounded-lg border border-border text-[10px] font-bold flex items-center gap-1 hover:bg-accent transition-colors disabled:opacity-40">
                  <LogOut className="h-3 w-3" /> Sign out all other devices
                </button>
              </div>
            </>
          )}
        </div>

        {/* Security event feed */}
        {security && security.events.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2"><History className="h-3 w-3" /> Recent security activity</p>
            <div className="divide-y divide-border">
              {security.events.slice(0, 8).map((ev) => (
                <div key={ev.id} className="py-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] flex items-center gap-1.5 min-w-0">
                    {ev.kind === "LOGIN_OK" || ev.kind === "DEVICE_SYNCED" || ev.kind === "PASSWORD_CHANGED" || ev.kind === "DEVICE_AUTO_APPROVED"
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                      : <XCircle className="h-3 w-3 text-red-400 shrink-0" />}
                    <span className="font-semibold shrink-0">{EVENT_LABEL[ev.kind] ?? ev.kind}</span>
                    <span className="text-muted-foreground truncate">{ev.detail ?? ""}</span>
                  </p>
                  <span className="text-[9px] text-muted-foreground shrink-0">{new Date(ev.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Company identity & branches — the Engineer owns the letterhead */}
      {isAdmin && (
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-bold flex items-center gap-1.5"><Building2 className="h-4 w-4 text-primary" /> Company &amp; branches</h2>
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            The name and logo here print on every work order and status report. Branches prepare the system to
            spread across other departments and sites nationwide: Packaging, Utility, other plants.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="h-12 w-12 rounded-xl border border-border bg-secondary/40 flex items-center justify-center overflow-hidden shrink-0">
              {data.org.logoUrl
                ?  
                  <img src={data.org.logoUrl} alt="Company logo" className="h-full w-full object-contain" />
                : <Upload className="h-4 w-4 text-muted-foreground" />}
            </div>
            <button onClick={() => logoInput.current?.click()} disabled={busy !== null} className="h-10 px-3 rounded-lg bg-secondary border border-border text-xs font-bold flex items-center gap-1.5 hover:bg-accent transition-colors disabled:opacity-50">
              {busy === "logo" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {data.org.logoUrl ? "Replace logo" : "Upload company logo"}
            </button>
            <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { uploadLogo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            {data.org.logoUrl && (
              <button onClick={async () => { await patchOrg({ logoUrl: null }); toast.info("Logo removed. Reports fall back to the built-in mark."); refresh(); }} className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                remove
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Company name on reports" className="flex-1 h-10 rounded-lg bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
            <button onClick={saveOrgName} disabled={busy !== null || orgName === data.org.name} className="h-10 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50">Save name</button>
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Branches ({data.org.branches.filter((b) => b.active).length} active)</p>
            {data.org.branches.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No branches yet. Add your first site below.</p>
            )}
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {data.org.branches.map((b) => (
                <div key={b.id} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold truncate">{b.name}{!b.active && <span className="text-[9px] text-muted-foreground font-normal"> · dormant</span>}</p>
                    <p className="text-[9.5px] text-muted-foreground">{b.location ?? "No location set"}</p>
                  </div>
                  <button
                    onClick={async () => { await patchBranch({ id: b.id, active: !b.active }); toast.success(b.active ? `${b.name} marked dormant` : `${b.name} reactivated`); refresh(); }}
                    className={`h-8 px-2.5 rounded-lg border text-[10px] font-bold shrink-0 ${b.active ? "border-border text-muted-foreground hover:text-foreground" : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"}`}
                  >
                    {b.active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newBranch.name} onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })} placeholder="Branch name (e.g. Ilesha Plant)" className="flex-1 h-10 rounded-lg bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
              <input value={newBranch.location} onChange={(e) => setNewBranch({ ...newBranch, location: e.target.value })} placeholder="Location" className="w-36 sm:w-48 h-10 rounded-lg bg-background border border-input px-3 text-xs outline-none focus:ring-2 focus:ring-primary/50" />
              <button onClick={addBranch} disabled={busy !== null} className="h-10 px-3 rounded-lg bg-secondary border border-border text-xs font-bold flex items-center gap-1 disabled:opacity-50 shrink-0">
                {busy === "branch" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null} Add
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Admin tools */}
      {isAdmin && (
        <section>
          <h2 className="text-sm font-bold mb-2">Engineering tools</h2>
          <div className="space-y-2">
            <button
              onClick={runScheduler}
              disabled={busy !== null}
              className="w-full h-12 rounded-xl border border-border bg-card px-4 flex items-center gap-3 text-left hover:bg-accent/50 transition-colors disabled:opacity-50"
            >
              {busy === "scheduler" ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : <CalendarClock className="h-4 w-4 text-primary" />}
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">Run PM scheduler now</span>
                <span className="block text-[10px] text-muted-foreground">Auto-generates weekly & monthly PMs. Also runs itself every app load</span>
              </span>
            </button>
            <button
              onClick={exportHistory}
              className="w-full h-12 rounded-xl border border-border bg-card px-4 flex items-center gap-3 text-left hover:bg-accent/50 transition-colors"
            >
              <Download className="h-4 w-4 text-primary" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">Export 90-day audit history (CSV)</span>
                <span className="block text-[10px] text-muted-foreground">Full immutable trail · food-safety & ISO ready</span>
              </span>
            </button>
          </div>
        </section>
      )}

      {/* My machines (artisan) */}
      {!isAdmin && data.machines.length > 0 && (
        <section>
          <h2 className="text-sm font-bold mb-2">Machines on the plant registry</h2>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden max-h-72 overflow-y-auto brewops-scroll">
            {data.machines.map((m) => (
              <div key={m.id} className="px-3.5 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold"><span className="text-primary font-mono text-[10px] mr-1.5">{m.code}</span>{m.name}</p>
                  <p className="text-[10px] text-muted-foreground">{m.departmentName}{m.location ? ` · ${m.location}` : ""}{m.ownerName === data.user.name ? " · yours" : m.ownerName ? ` · ${m.ownerName}` : ""}</p>
                </div>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {pmCycleLabel(m.pmCycle, m.pmDay)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Install PWA */}
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <h2 className="text-sm font-bold flex items-center gap-1.5"><Smartphone className="h-4 w-4 text-primary" /> Make it feel like an app</h2>
        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
          Open this page in <b>Safari</b> (iPhone) or <b>Chrome</b> (Android) → tap <b>Share / ⋮</b> →{" "}
          <b>Add to Home Screen</b>. BrewOps will open fullscreen with its own icon. No browser bars, no app store.
        </p>
      </section>

      {/* Pilot info */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold flex items-center gap-1.5 mb-2"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Pilot facts</h2>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <p className="text-muted-foreground">Registry: <b className="text-foreground">{data.machines.length} machines</b></p>
          <p className="text-muted-foreground">Components: <b className="text-foreground">{data.stats.totalComponents}</b></p>
          <p className="text-muted-foreground">Open WOs: <b className="text-foreground">{data.stats.openWorkOrders}</b></p>
          <p className="text-muted-foreground">7-day completion: <b className="text-foreground">{data.stats.completionRate7d}%</b></p>
          <p className="text-muted-foreground">Avg completion: <b className="text-foreground">{data.stats.avgCompletionHours !== null ? `${data.stats.avgCompletionHours}h` : "no data yet"}</b></p>
          <p className="text-muted-foreground">Low stock parts: <b className="text-foreground">{data.stats.lowStockCount}</b></p>
        </div>
      </section>

      {/* Actions */}
      <section className="space-y-2 pb-4">
        <button
          onClick={() => refresh()}
          className="w-full h-12 rounded-xl border border-border bg-card text-sm font-semibold flex items-center justify-center gap-2 hover:bg-accent/50 transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Refresh data
        </button>
        <button
          onClick={onLogout}
          className="w-full h-12 rounded-xl border border-red-500/40 text-red-400 text-sm font-bold flex items-center justify-center gap-2 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
        <p className="text-[9px] text-muted-foreground text-center pt-1 flex items-center justify-center gap-1">
          <UserRound className="h-3 w-3" /> BrewOps pilot · every action you take is timestamped in your name
        </p>
      </section>
    </div>
  );
}

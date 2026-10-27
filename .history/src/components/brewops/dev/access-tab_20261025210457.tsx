"use client";

// Access tab — the license desk (with an at-a-glance activation overview)
// plus the live sessions & trusted-devices manager with remote revocation.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound, Laptop, LoaderCircle, LogOut, MonitorSmartphone, RotateCcw, Search, ShieldCheck, Users,
} from "lucide-react";
import {
  devLicensePatch, devLicenses, devSessionPatch, devSessions,
  type DevDeviceRow, type DevLicenseUser, type DevSessionRow, type DevSessionsData,
} from "@/lib/client-api";
import { SectionCard, fmtAgo, fmtWhen } from "./shared";

function PlatformIcon({ platform, mobile }: { platform: string | null; mobile: boolean }) {
  const Icon = platform === "Windows" ? Laptop : MonitorSmartphone;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function RatioBar({ active, inactive }: { active: number; inactive: number }) {
  const total = active + inactive;
  const pct = total ? Math.round((active / total) * 100) : 0;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${pct}% of licenses active`}>
        <div className="bg-emerald-500 transition-all" style={{ width: `${total ? (active / total) * 100 : 0}%` }} />
        <div className="bg-amber-500 transition-all" style={{ width: `${total ? (inactive / total) * 100 : 0}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{pct}% of licenses activated</p>
    </div>
  );
}

export default function AccessTab({ onChanged }: { onChanged?: () => void }) {
  const [users, setUsers] = useState<DevLicenseUser[] | null>(null);
  const [live, setLive] = useState<DevSessionsData | null>(null);
  const [search, setSearch] = useState("");
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusyUser("*");
    try {
      const [l, s] = await Promise.all([devLicenses(), devSessions()]);
      setUsers(l.users);
      setLive(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load access data");
    } finally {
      setBusyUser(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.name} ${u.email} ${u.licenseKey ?? ""}`.toLowerCase().includes(q));
  }, [users, search]);

  const activeCount = users?.filter((u) => u.licenseActive).length ?? 0;
  const inactiveCount = users?.filter((u) => !u.licenseActive).length ?? 0;
  const missingCount = users?.filter((u) => !u.licenseKey).length ?? 0;

  const licenseAction = async (payload: { userId?: string; licenseActive?: boolean; regenerate?: boolean; fillMissing?: boolean }) => {
    try {
      const res = await devLicensePatch(payload);
      if (payload.fillMissing) toast.success(`Issued ${res.filled ?? 0} missing license key(s)`);
      else if (payload.regenerate) toast.success(`New key issued: ${res.licenseKey}`);
      else toast.success(payload.licenseActive ? "License activated" : "License deactivated");
      await load(true);
      onChanged?.();
      return res;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return null;
    }
  };

  const revoke = async (payload: { sessionId?: string; userId?: string; deviceId?: string; all?: boolean }, label: string) => {
    try {
      const res = await devSessionPatch(payload);
      toast.success(label + (res.revoked ? ` (${res.revoked} session(s))` : ""));
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revocation failed");
    }
  };

  const copyKey = (key: string | null) => {
    if (!key) return;
    void navigator.clipboard?.writeText(key).then(() => toast.success("License key copied")).catch(() => toast.error("Copy failed"));
  };

  const revokeUserAll = async (s: DevSessionRow) => {
    const u = users?.find((x) => x.email === s.userEmail);
    if (u) await revoke({ userId: u.id }, `${s.userName} signed out everywhere`);
  };

  return (
    <div className="space-y-6">
      {/* ---- License overview strip ---- */}
      <SectionCard icon={ShieldCheck} title="License overview" desc="Activation state of every account at a glance.">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Active</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{activeCount}</p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Inactive</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-500">{inactiveCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-secondary/30 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Missing keys</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{missingCount}</p>
          </div>
        </div>
        <div className="mt-4">
          <RatioBar active={activeCount} inactive={inactiveCount} />
        </div>
      </SectionCard>

      {/* ---- License desk ---- */}
      <SectionCard icon={KeyRound} title="Access licenses" desc="Every registered artisan holds a license key. Inactive accounts can sign in but see the activation notice until you switch them on.">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or license key"
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => void licenseAction({ fillMissing: true })}
            className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent transition-colors inline-flex items-center gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Fill missing keys
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-border overflow-hidden">
          <div className="max-h-96 overflow-y-auto brewops-scroll">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-3 py-2 font-bold">Account</th>
                  <th className="px-3 py-2 font-bold">License key</th>
                  <th className="px-3 py-2 font-bold">Status</th>
                  <th className="px-3 py-2 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users === null) && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">Loading accounts…</td></tr>
                )}
                {users !== null && filtered.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">No accounts match.</td></tr>
                )}
                {filtered.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold leading-tight">{u.name}{u.role === "ADMIN" && <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">Engineer</span>}</p>
                      <p className="text-[11px] text-muted-foreground">{u.email}{u.trade ? ` · ${u.trade.toLowerCase()}` : ""}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      {u.licenseKey ? (
                        <button onClick={() => copyKey(u.licenseKey)} className="font-mono text-xs font-semibold tracking-wider hover:text-primary transition-colors" title="Copy key">
                          {u.licenseKey}
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic">not issued</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${u.licenseActive ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500" : "border-amber-500/40 bg-amber-500/10 text-amber-500"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.licenseActive ? "bg-emerald-500" : "bg-amber-500"}`} />
                        {u.licenseActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => void licenseAction({ userId: u.id, licenseActive: !u.licenseActive })}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${u.licenseActive ? "border border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" : "bg-emerald-600 text-white hover:opacity-90"}`}
                      >
                        {u.licenseActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => void licenseAction({ userId: u.id, regenerate: true })}
                        className="ml-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent transition-colors"
                        title="Issue a fresh license key"
                      >
                        New key
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          New artisans are registered from the Team tab with a license ready - they start INACTIVE. Tap a key to copy it.
        </p>
      </SectionCard>

      {/* ---- Live sessions ---- */}
      <SectionCard icon={Users} title={`Live sessions${live ? ` · ${live.sessions.length}` : ""}`} desc="Everyone currently signed in, from where. Revoke any of them remotely.">
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="max-h-80 overflow-y-auto brewops-scroll">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-3 py-2 font-bold">User</th>
                  <th className="px-3 py-2 font-bold hidden sm:table-cell">Device</th>
                  <th className="px-3 py-2 font-bold hidden md:table-cell">Signed in</th>
                  <th className="px-3 py-2 font-bold">Last seen</th>
                  <th className="px-3 py-2 font-bold text-right">Revoke</th>
                </tr>
              </thead>
              <tbody>
                {live === null && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">Loading sessions…</td></tr>
                )}
                {live !== null && live.sessions.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">No active sessions right now.</td></tr>
                )}
                {live?.sessions.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-2.5">
                      <p className="font-semibold leading-tight">{s.userName}{s.role === "ADMIN" && <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">Engineer</span>}</p>
                      <p className="text-[11px] text-muted-foreground">{s.userEmail}</p>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <p className="text-xs flex items-center gap-1.5"><PlatformIcon platform={s.platform} mobile={!s.deviceName?.includes("PC")} /><span className="truncate max-w-[140px]">{s.deviceName ?? "Unknown device"}</span></p>
                      {s.ip && <p className="text-[10px] text-muted-foreground font-mono">{s.ip}</p>}
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell text-xs text-muted-foreground">{fmtWhen(s.createdAt)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtAgo(s.lastSeenAt)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => void revoke({ sessionId: s.id }, "Session revoked")}
                        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-500 hover:bg-amber-500/20 transition-colors"
                      >
                        Kick
                      </button>
                      <button
                        onClick={() => void revokeUserAll(s)}
                        className="ml-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Sign this user out of every device"
                      >
                        All
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>

      {/* ---- Trusted devices ---- */}
      <SectionCard icon={MonitorSmartphone} title={`Trusted devices${live ? ` · ${live.devices.length}` : ""}`} desc="Devices that passed device-synchronization. Revoking one forces its next login through the full pairing wall.">
        <div className="grid gap-2">
          {live === null && <p className="text-xs text-muted-foreground py-3">Loading devices…</p>}
          {live !== null && live.devices.length === 0 && <p className="text-xs text-muted-foreground py-3">No devices registered yet.</p>}
          {live?.devices.map((d) => <DeviceRow key={d.id} d={d} onRevoke={() => void revoke({ deviceId: d.id }, `${d.name} revoked`)} />)}
        </div>
      </SectionCard>

      {/* ---- Plant-wide lockout ---- */}
      <SectionCard icon={LogOut} title="Sign everyone out" desc="Instantly revokes every session in the plant — all phones and PCs return to the login screen. Devices stay trusted; PIN unlock keeps working after they sign back in." tone="danger">
        <div className="flex gap-2">
          <input
            type="text"
            value={confirmAll}
            onChange={(e) => setConfirmAll(e.target.value)}
            placeholder='Type "SIGNOUT"'
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={() => void revoke({ all: true }, "Everyone signed out")}
            disabled={confirmAll !== "SIGNOUT" || busyUser === "*"}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {busyUser === "*" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Sign out all
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

function DeviceRow({ d, onRevoke }: { d: DevDeviceRow; onRevoke: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
      <div className="h-9 w-9 shrink-0 rounded-lg bg-secondary flex items-center justify-center">
        <PlatformIcon platform={d.platform} mobile={d.mobile} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">
          {d.name}
          {d.approved
            ? <span className="ml-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-500">Trusted</span>
            : <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-500">Untrusted</span>}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">{d.userName} · {d.platform ?? "Unknown OS"} · seen {fmtAgo(d.lastSeenAt)}</p>
      </div>
      <button
        onClick={onRevoke}
        className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-500 hover:bg-amber-500/20 transition-colors"
      >
        Revoke
      </button>
    </div>
  );
}

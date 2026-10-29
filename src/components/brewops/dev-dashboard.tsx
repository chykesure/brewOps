"use client";

// The owner's private developer console — reached only after the Shift+Alt+B
// PIN gate. Tabbed layout: Overview · Trends · Access · Accounts · Data · Audit.
// Overview: live counters + the maintenance-mode master switch.
// Trends:   per-day usage charts. Access: licenses + sessions/devices.
// Accounts: mint & manage accounts (works on an empty database — bootstrap).
// Data:     backups, restore points, resets. Audit: the operation trail.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity, ClipboardList, CircleDollarSign, Cpu, Database, DoorOpen, Gauge, KeyRound,
  LoaderCircle, Lock, MonitorSmartphone, PieChart, Power, RefreshCw, ScrollText,
  UserPlus, Users, Wrench,
} from "lucide-react";
import { devLock, devMaintenanceSet, devQuickSignInSet, devStats, type DevStats } from "@/lib/client-api";
import { SectionCard, StatCard } from "./dev/shared";
import TrendsTab from "./dev/trends-tab";
import AccessTab from "./dev/access-tab";
import AccountsTab from "./dev/accounts-tab";
import DataTab from "./dev/data-tab";
import AuditTab from "./dev/audit-tab";

type Tab = "overview" | "trends" | "access" | "accounts" | "data" | "audit";

const TABS: { id: Tab; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "trends", label: "Trends", icon: PieChart },
  { id: "access", label: "Access", icon: KeyRound },
  { id: "accounts", label: "Accounts", icon: UserPlus },
  { id: "data", label: "Data", icon: Database },
  { id: "audit", label: "Audit", icon: ScrollText },
];

function MaintenanceSwitch({ stats, onFlipped }: { stats: DevStats | null; onFlipped: () => void }) {
  const [on, setOn] = useState(stats?.maintenance ?? false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(stats?.maintenance ?? false), [stats?.maintenance]);

  const flip = async () => {
    const next = !on;
    setBusy(true);
    try {
      await devMaintenanceSet(next);
      setOn(next);
      toast.success(next ? "Maintenance mode ON — artisans are locked out" : "Maintenance mode OFF — everyone back in");
      onFlipped();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not flip maintenance mode");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      icon={Wrench}
      title="Maintenance mode"
      desc="One switch for planned downtime. Artisans land on a maintenance screen and cannot touch data; engineers keep full access (including this console)."
    >
      <div className={`rounded-xl border p-4 ${on ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-secondary/30"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Power className={`h-4 w-4 ${on ? "text-amber-500" : "text-muted-foreground"}`} />
              {on ? "Maintenance is ON" : "Maintenance is OFF"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {on ? "Artisans see the maintenance screen on every action until you flip this off." : "Everyone is working normally."}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={on}
            aria-label="Toggle maintenance mode"
            onClick={() => void flip()}
            disabled={busy}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-amber-500" : "bg-secondary border border-border"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

function QuickSignInSwitch({ stats, onFlipped }: { stats: DevStats | null; onFlipped: () => void }) {
  const [on, setOn] = useState(stats?.quickSignIn ?? true);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(stats?.quickSignIn ?? true), [stats?.quickSignIn]);

  const flip = async () => {
    const next = !on;
    setBusy(true);
    try {
      await devQuickSignInSet(next);
      setOn(next);
      toast.success(next ? "Quick sign-in is back on the login screen" : "Quick sign-in hidden — login shows email + PIN only");
      onFlipped();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the login screen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      icon={DoorOpen}
      title="Login screen"
      desc="Control what the sign-in door shows to everyone who opens BrewOps."
    >
      <div className={`rounded-xl border p-4 ${on ? "border-border bg-secondary/30" : "border-amber-500/40 bg-amber-500/5"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Power className={`h-4 w-4 ${on ? "text-muted-foreground" : "text-amber-500"}`} />
              Quick sign-in (pilot devices) {on ? "visible" : "hidden"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {on
                ? "The pilot chip sits under the sign-in form and fills accounts with one tap. Fine for the pilot floor."
                : "Hidden — the login now looks like production: work email + PIN only. Anyone with the door open sees the change after a reload."}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={on}
            aria-label="Toggle quick sign-in on the login screen"
            onClick={() => void flip()}
            disabled={busy}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-primary" : "bg-secondary border border-border"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

export default function DevDashboard({ onExit }: { onExit: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<DevStats | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStats = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      setStats(await devStats());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load console data");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const exit = async () => {
    await devLock().catch(() => null);
    onExit();
  };

  return (
    <div className="app-backdrop min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur border-b border-border px-4 md:px-8 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Cpu className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight tracking-tight flex items-center gap-2">
              Developer Console
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-500">private</span>
              {stats?.maintenance && (
                <span className="rounded-full border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-500 animate-pulse">maintenance</span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground leading-tight">BrewOps · data, access and health</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadStats()} disabled={busy} className="rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent transition-colors inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button onClick={() => void exit()} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity inline-flex items-center gap-1.5">
            <Lock className="h-4 w-4" />
            Lock &amp; exit
          </button>
        </div>
      </header>

      {/* ---- Tab bar ---- */}
      <nav className="sticky top-[61px] z-20 bg-background/90 backdrop-blur border-b border-border px-4 md:px-8 flex gap-1 overflow-x-auto brewops-scroll" aria-label="Console sections">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative shrink-0 px-3.5 py-2.5 text-xs font-bold transition-colors inline-flex items-center gap-1.5 ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.id === "access" && stats && stats.activeSessions > 0 && (
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/40 px-1.5 text-[9px] text-emerald-400">{stats.activeSessions}</span>
              )}
              {t.id === "audit" && stats && stats.maintenance && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </nav>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-6 pb-16">
        {tab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard icon={Users} label="Accounts" value={stats?.users ?? "-"} hint={`${stats?.admins ?? 0} engineer · ${stats?.artisans ?? 0} artisan`} />
              <StatCard icon={Gauge} label="Machines" value={stats?.machines ?? "-"} hint={`${stats?.components ?? 0} components`} />
              <StatCard icon={Activity} label="Status logs" value={stats?.statusLogs ?? "-"} hint={`${stats?.downtimes ?? 0} downtime records`} />
              <StatCard icon={ClipboardList} label="Work orders" value={stats?.workOrders ?? "-"} hint={`${stats?.openWorkOrders ?? 0} still open`} />
              <StatCard icon={Database} label="Database" value={stats ? `${(stats.dbSize / 1024).toFixed(0)} KB` : "-"} hint={`${stats?.parts ?? 0} spares · ${stats?.escalations ?? 0} escalations`} />
              <StatCard icon={KeyRound} label="Inactive licenses" value={stats?.inactiveLicenses ?? "-"} hint="awaiting your activation" />
              <StatCard icon={CircleDollarSign} label="Missing keys" value={stats?.unlicensed ?? "-"} hint="accounts without a license" />
              <StatCard icon={Cpu} label="Trusted devices" value={stats?.devices ?? "-"} hint="synchronised phones & PCs" />
              <StatCard icon={MonitorSmartphone} label="Live sessions" value={stats?.activeSessions ?? "-"} hint="people signed in right now" />
            </div>

            <MaintenanceSwitch stats={stats} onFlipped={() => void loadStats(true)} />

            <QuickSignInSwitch stats={stats} onFlipped={() => void loadStats(true)} />

            <SectionCard icon={Activity} title="Session policy" desc="Applies to every account, engineer and artisan alike.">
              <div className="rounded-xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed">
                <p><span className="font-semibold">Automatic sign-out:</span> 10 minutes without any mouse, keyboard or touch input.</p>
                <p className="mt-1 text-xs text-muted-foreground">A countdown warning shows 60 seconds before sign-out, and any activity cancels it. The timeout is set in <code className="font-mono text-[11px]">src/components/brewops/idle-logout.tsx</code> if it ever needs tuning.</p>
              </div>
            </SectionCard>
          </div>
        )}

        {tab === "trends" && <TrendsTab />}
        {tab === "access" && <AccessTab onChanged={() => void loadStats(true)} />}
        {tab === "accounts" && <AccountsTab onChanged={() => void loadStats(true)} />}
        {tab === "data" && <DataTab onChanged={() => void loadStats(true)} />}
        {tab === "audit" && <AuditTab onChanged={() => void loadStats(true)} />}
      </main>
    </div>
  );
}
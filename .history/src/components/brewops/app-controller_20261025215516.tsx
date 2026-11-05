"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBootstrap, fetchPulse, logout, devStatus, ApiError, CLIENT_TZ } from "@/lib/client-api";
import type { BootstrapData } from "@/lib/types";
import { localDateStr } from "@/lib/status";
import LoginView from "@/components/brewops/login-view";
import IdleLogout from "@/components/brewops/idle-logout";
import LicenseNotice from "@/components/brewops/license-notice";
import MaintenanceScreen from "@/components/brewops/maintenance-screen";
import InstallAppButton from "@/components/brewops/install-app-button";
import DevGate from "@/components/brewops/dev-gate-modal";
import DevDashboard from "@/components/brewops/dev-dashboard";
import ArtisanHome from "@/components/brewops/views/artisan-home";
import RoundView from "@/components/brewops/views/round-view";
import WorksView from "@/components/brewops/views/works-view";
import AdminDashboard from "@/components/brewops/views/admin-dashboard";
import AdminMachines from "@/components/brewops/views/admin-machines";
import AdminWorkOrders from "@/components/brewops/views/admin-workorders";
import TeamView from "@/components/brewops/views/team-view";
import ReportsView from "@/components/brewops/views/reports-view";
import TrendsView from "@/components/brewops/views/trends-view";
import ProfileView from "@/components/brewops/views/profile-view";
import { Beer, ClipboardList, Gauge, Home, FileText, Radar, TrendingUp, UserRound, UsersRound, Wrench } from "lucide-react";
import { Avatar } from "@/components/brewops/avatar";

type Tab = "home" | "round" | "work" | "dash" | "machines" | "team" | "reports" | "trends" | "profile";

const ARTISAN_TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "round", label: "My Round", icon: Radar },
  { id: "work", label: "Work", icon: ClipboardList },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "trends", label: "Trends", icon: TrendingUp },
  { id: "profile", label: "Profile", icon: UserRound },
];
const ADMIN_TABS: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "dash", label: "Command", icon: Gauge },
  { id: "work", label: "Work", icon: ClipboardList },
  { id: "machines", label: "Registry", icon: Beer },
  { id: "team", label: "Team", icon: UsersRound },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "trends", label: "Trends", icon: TrendingUp },
  { id: "profile", label: "Profile", icon: UserRound },
];

export default function BrewOpsApp() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  // One-shot navigation flag: the Home "Plant Status Register" card opens My Round
  // straight into the register, then resets so the nav tab behaves normally again.
  const [roundStart, setRoundStart] = useState<"round" | "register">("round");
  const [refreshing, setRefreshing] = useState(false);
  const [liveAt, setLiveAt] = useState<Date | null>(null);
  const [liveFlash, setLiveFlash] = useState(false);
  // Owner's private developer console (Shift+Alt+B + PIN): devMode swaps the
  // whole shell for the console; devGateOpen shows the PIN box.
  const [devMode, setDevMode] = useState(false);
  const [devGateOpen, setDevGateOpen] = useState(false);
  const mounted = useRef(true);
  const revRef = useRef<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const d = await fetchBootstrap(localDateStr(), CLIENT_TZ);
      if (mounted.current) {
        setData(d);
        setBootError(null);
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
      } else {
        setBootError(e instanceof Error ? e.message : "Connection failed");
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    // Refresh when the app becomes visible again (artisan returning from the floor)
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  // ── Two-way live feed ── every dashboard beats against /api/pulse every 5s;
  // when the plant's data fingerprint moves (an artisan logs a status, the Engineer
  // creates a work order, spares move, an escalation lands) the app silently
  // re-fetches the bootstrap, so both sides always watch the same live picture.
  const userId = data?.user?.id;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const p = await fetchPulse();
        if (!alive) return;
        const prev = revRef.current;
        revRef.current = p.rev;
        setLiveAt(new Date());
        // First beat only sets the baseline — a real change triggers the refetch
        if (prev !== null && prev !== p.rev) {
          setLiveFlash(true);
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => {
            if (alive) setLiveFlash(false);
          }, 1800);
          void refresh(true);
        }
      } catch {
        // Offline or server restarting — keep the last good screen; next beat retries
      }
    };

    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
      if (flashTimer) clearTimeout(flashTimer);
    };
  }, [userId, refresh]);

  const isAdmin = data?.user.role === "ADMIN";
  const tabs = isAdmin ? ADMIN_TABS : ARTISAN_TABS;

  // Reset to a sensible tab per role
  useEffect(() => {
    if (!data) return;
    setTab((t) => {
      const valid = (isAdmin ? ADMIN_TABS : ARTISAN_TABS).some((x) => x.id === t);
      return valid ? t : isAdmin ? "dash" : "home";
    });
  }, [data, isAdmin]);

  // Document-level scroll: jump back to top when switching sections
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  const onLogout = useCallback(async () => {
    await logout().catch(() => null);
    setData(null);
    setTab("home");
  }, []);

  // ---- Developer console gate (Shift+Alt+B, or 7 quick taps on a BrewOps
  // logo) ---- the PIN itself is verified server-side; if the dev cookie is
  // still valid the console opens directly. The gate modal is rendered
  // OUTSIDE the sign-in/app branches below, so the shortcut also opens it
  // from the login screen (it used to be swallowed there).
  const openDevConsole = useCallback(() => {
    if (devMode) return;
    const probe = devStatus();
    void (async () => {
      try {
        const s = await Promise.race([
          probe,
          new Promise<null>((r) => setTimeout(() => r(null), 350)),
        ]);
        if (s?.unlocked) {
          sessionStorage.setItem("brewops_dev_ui", "1");
          setDevMode(true);
          return;
        }
      } catch {
        // fall through to the PIN box
      }
      setDevGateOpen(true);
      void probe.then((s) => {
        // a slow-but-valid cookie skips the PIN box entirely
        if (s.unlocked) {
          sessionStorage.setItem("brewops_dev_ui", "1");
          setDevGateOpen(false);
          setDevMode(true);
        }
      }).catch(() => null);
    })();
  }, [devMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isB = e.code === "KeyB" || e.key === "b" || e.key === "B";
      if (!isB || e.metaKey || !e.altKey) return;
      // Shift+Alt+B is the promised combo; Ctrl+Alt+B is the Windows-safe
      // twin because Alt+Shift is the OS input-language hotkey on many
      // machines and can swallow the keystroke before the browser sees it.
      if (!e.shiftKey && !e.ctrlKey) return;
      e.preventDefault();
      openDevConsole();
    };
    // Capture phase: the very first handler that can run, so nothing inside
    // the page (modals, inputs, panels) can swallow the combo first.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openDevConsole]);

  // Keyboard-free owners' entry (phones / focus stolen by parent frames):
  // seven quick taps on any BrewOps logo within 4 seconds. Deliberately
  // silent - no hint is shown to other users.
  useEffect(() => {
    let taps: number[] = [];
    const onTap = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || typeof el.closest !== "function") return;
      if (!el.closest("[data-dev-trigger]")) return;
      const now = Date.now();
      taps = taps.filter((t) => now - t < 4000);
      taps.push(now);
      if (taps.length >= 7) {
        taps = [];
        openDevConsole();
      }
    };
    document.addEventListener("click", onTap);
    return () => document.removeEventListener("click", onTap);
  }, [openDevConsole]);

  // A freshly reloaded tab returns straight into the console while the dev
  // cookie is still alive (sessionStorage remembers the owner was inside).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("brewops_dev_ui") !== "1") return;
    void devStatus().then((s) => {
      if (s.unlocked) setDevMode(true);
      else sessionStorage.removeItem("brewops_dev_ui");
    }).catch(() => null);
  }, []);

  // Bookmarkable entry: opening the app with #dev shows the same private PIN
  // gate (or the console itself when the dev cookie is still valid). Gives
  // the owner a zero-keyboard, zero-gesture path on any device. Handles both
  // fresh loads and live hash edits (hashchange).
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== "#dev") return;
      window.history.replaceState(null, "", window.location.pathname);
      openDevConsole();
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openDevConsole]);

  const onDevExit = useCallback(() => {
    sessionStorage.removeItem("brewops_dev_ui");
    setDevMode(false);
    void refresh(true);
  }, [refresh]);

  const devGate = (
    <DevGate
      open={devGateOpen}
      onClose={() => setDevGateOpen(false)}
      onSuccess={() => {
        sessionStorage.setItem("brewops_dev_ui", "1");
        setDevGateOpen(false);
        setDevMode(true);
      }}
    />
  );

  const content = useMemo(() => {
    if (!data) return null;
    switch (tab) {
      case "home": return (
        <ArtisanHome
          data={data}
          onGoRound={() => setTab("round")}
          onGoWork={() => setTab("work")}
          onGoTrends={() => setTab("trends")}
          onGoProfile={() => setTab("profile")}
          onGoRegister={() => {
            setRoundStart("register");
            setTab("round");
          }}
        />
      );
      case "round": return (
        <RoundView
          data={data}
          refresh={() => refresh()}
          startMode={roundStart}
          onConsumeStart={() => setRoundStart("round")}
        />
      );
      case "dash": return (
        <AdminDashboard
          data={data}
          refresh={() => refresh()}
          onGoMachines={() => setTab("machines")}
          onGoWork={() => setTab("work")}
          onGoTrends={() => setTab("trends")}
          onGoTeam={() => setTab("team")}
          onGoReports={() => setTab("reports")}
          onGoProfile={() => setTab("profile")}
        />
      );
      case "machines": return <AdminMachines data={data} refresh={() => refresh()} />;
      case "team": return <TeamView data={data} refresh={() => refresh()} />;
      case "reports": return <ReportsView data={data} />;
      case "trends": return <TrendsView />;
      case "work": return isAdmin
        ? <AdminWorkOrders data={data} refresh={() => refresh()} />
        : <WorksView data={data} refresh={() => refresh()} />;
      case "profile": return <ProfileView data={data} onLogout={onLogout} refresh={() => refresh()} />;
      default: return null;
    }
  }, [data, tab, isAdmin, refresh, onLogout]);

  if (devMode) {
    return (
      <>
        <DevDashboard onExit={onDevExit} />
        {devGate}
      </>
    );
  }

  if (loading) {
    return (
      <>
        <div className="app-backdrop min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center animate-pulse">
              <Beer className="h-7 w-7 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground animate-pulse">Loading BrewOps…</p>
          </div>
        </div>
        {devGate}
      </>
    );
  }

  if (!data) {
    return (
      <>
        <LoginView onSuccess={() => refresh(true)} bootError={bootError} />
        {devGate}
      </>
    );
  }

  // Maintenance lockout — the owner flips this from the dev console. Artisans
  // land on the maintenance screen; engineers keep working (and see a banner).
  if (data.maintenance && data.user.role === "ARTISAN") {
    return (
      <>
        <MaintenanceScreen onRefresh={() => void refresh()} refreshing={refreshing} />
        {devGate}
      </>
    );
  }

  const criticalAlerts = data.alerts.filter((a) => a.severity === "CRITICAL").length;
  const liveLabel = liveAt ? liveAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  const livePill = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${liveFlash ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-border bg-secondary/60 text-muted-foreground"}`}
      title={liveFlash ? "New data just landed from the floor" : "Live feed \u00b7 the dashboard refreshes itself"}
      role="status"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${liveFlash ? "bg-emerald-400" : "bg-emerald-500/80 animate-pulse"}`} />
      {liveFlash ? "Live update" : "Live"}
      {liveLabel && !liveFlash && <span className="hidden sm:inline">{" · "}{liveLabel}</span>}
    </span>
  );

  return (
    <div className="app-backdrop min-h-screen flex flex-col">
      {/* ── Desktop sidebar (≥ md) ─────────────────────────────── */}
      <aside className="print-hide hidden md:flex fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-border bg-card/70 backdrop-blur">
        <div className="flex items-center gap-3 px-5 pt-6 pb-4" data-dev-trigger>
          <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <Beer className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight tracking-tight">BrewOps</p>
            <p className="text-[10px] text-muted-foreground leading-tight">Digital Work Order & PM System</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${isAdmin ? "bg-primary/15 text-primary border-primary/30" : "bg-secondary text-secondary-foreground border-border"}`}>
            {isAdmin ? "Brewing Engineer · Command" : "Artisan"}
          </span>
          {livePill}
        </div>
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto brewops-scroll">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                aria-label={t.label}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative h-8 w-8 rounded-lg flex items-center justify-center">
                  <Icon className="h-[18px] w-[18px]" />
                  {(t.id === "dash" || t.id === "work") && criticalAlerts > 0 && (
                    <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-card" />
                  )}
                </span>
                {t.label}
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </nav>
        <div className="px-3 pb-5 space-y-2">
          {/* PWA install — engineer and artisan alike: one tap puts BrewOps on the home screen */}
          <InstallAppButton variant="row" />
          <button
            onClick={() => setTab("profile")}
            className="w-full rounded-xl border border-border bg-secondary/40 p-3 flex items-center gap-3 hover:bg-accent/50 transition-colors text-left"
          >
            <Avatar name={data.user.name} avatarUrl={data.user.avatarUrl} className="h-9 w-9 text-[11px]" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold truncate">{data.user.name}</span>
              <span className="block text-[10px] text-muted-foreground truncate">{data.user.email}</span>
            </span>
          </button>
        </div>
      </aside>

      <div className="print-reset flex flex-1 flex-col md:pl-64">
        {/* Maintenance banner for the Engineer while artisans are locked out */}
        {data.maintenance && isAdmin && (
          <div className="bg-amber-500/15 border-b border-amber-500/40 px-4 md:px-6 py-2 text-[11px] font-semibold text-amber-500 flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            Maintenance mode is ON — artisans are locked out. Turn it off in the Dev Console → Overview.
          </div>
        )}
        <header className="print-hide sticky top-0 z-30 md:hidden bg-background/90 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5" data-dev-trigger>
            <div className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Beer className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-[15px] font-bold leading-tight tracking-tight">BrewOps</p>
              <p className="text-[10px] text-muted-foreground leading-tight">Digital Work Order & PM System</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {livePill}
            <InstallAppButton variant="icon" />
            <button
              onClick={() => setTab("profile")}
              className="flex items-center gap-2 rounded-full bg-secondary pl-1 pr-3 py-1 border border-border hover:bg-accent transition-colors"
            >
              <Avatar name={data.user.name} avatarUrl={data.user.avatarUrl} className="h-7 w-7 text-[9px]" />
              <span className="text-xs font-medium max-w-[110px] truncate">{data.user.name}</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 w-full max-w-md mx-auto md:max-w-6xl pb-24 md:pb-12" key={tab}>
          {bootError && (
            <div className="mx-4 mt-3 md:mr-6 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs px-3 py-2 flex items-center justify-between">
              <span>{bootError}</span>
              <button onClick={() => refresh()} className="underline underline-offset-2 font-semibold">Retry</button>
            </div>
          )}
          {content}
        </main>
      </div>

      {/* ── Mobile bottom navigation (< md) ───────────────────── */}
      <nav className="print-hide md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur border-t border-border pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative flex flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  aria-label={t.label}
                  aria-current={active ? "page" : undefined}
                >
                  <span className={`h-8 w-8 rounded-xl flex items-center justify-center transition-colors ${active ? "bg-primary/15" : ""}`}>
                    <Icon className="h-[18px] w-[18px]" />
                    {(t.id === "dash" || t.id === "work") && criticalAlerts > 0 && (
                      <span className="absolute -top-0.5 right-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-card" />
                    )}
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </nav>
      {/* ── Owner-only overlays ── */}
      <IdleLogout />
      {data.user.role === "ARTISAN" && data.user.licenseActive === false && (
        <LicenseNotice name={data.user.name} licenseKey={data.user.licenseKey ?? null} />
      )}
      {devGate}
    </div>
  );
}

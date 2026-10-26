"use client";

import { useEffect, useState } from "react";
import { login, fetchLoginOpts, ApiError } from "@/lib/client-api";
import { Beer, Lock, Mail, LogIn, LoaderCircle, ShieldCheck, Radar, AlertTriangle, FileText, Smartphone, MonitorSmartphone } from "lucide-react";

export default function LoginView({ onSuccess, bootError }: { onSuccess: () => void; bootError?: string | null }) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Owner-controlled from the Dev Console: when hidden, the login door shows
  // email + PIN only (no pilot quick sign-in chip). Defaults to visible so the
  // chip never flashes away on slow networks — then the fetch decides.
  const [quickSignIn, setQuickSignIn] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchLoginOpts()
      .then((o) => {
        if (alive) setQuickSignIn(o.quickSignIn !== false);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !pin.trim()) {
      setError("Enter your email and PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), pin.trim(), needsPassword ? password : undefined);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.body?.needsPassword) {
        setNeedsPassword(true);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-backdrop min-h-screen flex flex-col md:flex-row md:items-stretch">
      {/* ── Desktop brand panel (≥ md) ── */}
      <aside className="print-hide hidden md:flex flex-1 flex-col justify-center border-r border-border/60 px-14 py-16 lg:px-20 xl:px-28">
        <div data-dev-trigger className="h-16 w-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-6 shadow-lg shadow-primary/10">
          <Beer className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">BrewOps</h1>
        <p className="text-lg text-primary font-medium mt-1">Digital Work Order &amp; PM System</p>
        <p className="text-sm text-muted-foreground mt-4 max-w-md leading-relaxed">
          Every machine owned. Every task tracked. Every action timestamped. The daily report writes
          itself while you walk the floor.
        </p>
        <ul className="mt-8 space-y-3.5 text-sm max-w-md">
          <li className="flex items-start gap-3">
            <Radar className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <span><b className="font-semibold">Walk-the-floor status rounds</b> · 10 true machine states, logged in two taps, timestamped automatically.</span>
          </li>
          <li className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <span><b className="font-semibold">Instant engineer alerts</b> · Broken, Bypass, Simulation &amp; LOTO hit the Command Center the moment they&apos;re logged.</span>
          </li>
          <li className="flex items-start gap-3">
            <FileText className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <span><b className="font-semibold">Self-compiling daily report</b> · audit-ready, 1-click CSV &amp; print. No typing, no Excel.</span>
          </li>
        </ul>
        <div className="mt-8 max-w-md rounded-xl border border-border bg-card/60 p-3.5 flex items-start gap-3">
          <MonitorSmartphone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <b className="text-foreground">Device synchronization:</b> your phone is paired to your account the first time
            you sign in. A new phone or computer verifies ownership with your work password before it can be used. Manage
            trusted devices in Profile · Security.
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-8">Brewhouse maintenance pilot · work orders &amp; preventive scheduling</p>
      </aside>

      {/* ── Form column ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          {/* Brand — mobile only */}
          <div className="flex flex-col items-center text-center mb-8 md:hidden">
          <div data-dev-trigger className="h-16 w-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-4 shadow-lg shadow-primary/10">
            <Beer className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">BrewOps</h1>
          <p className="text-sm text-primary font-medium">Digital Work Order & PM System</p>
          <p className="text-xs text-muted-foreground mt-2 max-w-[26ch]">
            Every machine owned. Every task tracked. Every action timestamped.
          </p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-xl">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-muted-foreground">Work email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                id="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoComplete="email"
                placeholder="you@brewops.ng"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-12 rounded-xl bg-background border border-input pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pin" className="text-xs font-medium text-muted-foreground">PIN</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full h-12 rounded-xl bg-background border border-input pl-10 pr-3 text-lg tracking-[0.4em] outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {needsPassword && (
            <div className="space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" /> New device detected
              </p>
              <p className="text-[10.5px] text-muted-foreground leading-relaxed">
                This phone or computer has not been synchronized with your account yet. Enter your work
                password once to pair it. Afterwards your PIN unlocks this device directly.
              </p>
              <p className="text-[10.5px] text-amber-300/90 leading-relaxed font-medium">
                First synchronization? Your initial work password is the same as your login PIN. Change it
                afterwards in Profile · Security.
              </p>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="device-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Work password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 rounded-xl bg-background border border-input pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          )}

          {(error || bootError) && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error || bootError}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {busy ? "Signing in…" : needsPassword ? "Synchronize & sign in" : "Sign in"}
          </button>
        </form>

        {/* Quick sign-in — collapsed by default so the door looks like production.
            The owner can hide this chip entirely from the Dev Console → Login screen. */}
        {quickSignIn && (
          <QuickSignIn onPick={(email) => { setEmail(email); setPin("1234"); setPassword(""); setNeedsPassword(false); setError(null); }} />
        )}
      </div>
      </div>
    </div>
  );
}

function QuickSignIn({ onPick }: { onPick: (email: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 mx-auto"
      >
        <ShieldCheck className="h-3 w-3" /> Quick sign-in (pilot devices)
      </button>
    );
  }
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Quick sign-in · pilot devices · PIN 1234
        </p>
        <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-muted-foreground hover:text-foreground">hide</button>
      </div>
      <div className="space-y-1.5 text-xs">
        {[
          { label: "Brewing Engineer (Admin)", email: "engineer@brewops.ng" },
          { label: "Artisan · A. Yusuf", email: "yusuf@brewops.ng" },
          { label: "Artisan · M. Bello", email: "bello@brewops.ng" },
          { label: "Artisan · C. Okafor", email: "okafor@brewops.ng" },
        ].map((a) => (
          <button
            key={a.email}
            type="button"
            onClick={() => onPick(a.email)}
            className="w-full flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 hover:bg-accent transition-colors text-left"
          >
            <span className="font-medium">{a.label}</span>
            <span className="text-muted-foreground font-mono text-[10px]">{a.email}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

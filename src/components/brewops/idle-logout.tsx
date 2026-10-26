"use client";

// Session management: after 10 minutes without ANY interaction (mouse, keyboard,
// touch or scroll) the user is signed out automatically. A visible countdown
// appears 60 seconds before, so nobody loses unsaved work — any movement
// cancels the sign-out. A localStorage override (brewops_idle_ms) exists only
// for QA runs; normal users always get the default 10 minutes.
import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut, Timer } from "lucide-react";

const DEFAULT_IDLE_MS = 10 * 60_000;
const WARN_MS = 60_000;
const OVERRIDE_KEY = "brewops_idle_ms";

function idleTimeoutMs(): number {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 5000) return n;
    }
  } catch {
    // storage unavailable — use the default
  }
  return DEFAULT_IDLE_MS;
}

export default function IdleLogout() {
  const [remaining, setRemaining] = useState<number | null>(null); // seconds left, or null = no warning
  const lastActivity = useRef<number>(Date.now());
  const signingOut = useRef(false);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // network hiccup — clear the screen anyway, the cookie check will 401
    }
    window.location.reload();
  }, []);

  useEffect(() => {
    const mark = () => {
      lastActivity.current = Date.now();
    };

    // pointermove fires continuously — throttle it to once every 3s
    let lastMove = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - lastMove > 3000) {
        lastMove = now;
        mark();
      }
    };

    const events: [string, EventListener][] = [
      ["pointerdown", mark],
      ["keydown", mark],
      ["wheel", mark],
      ["touchstart", mark],
      ["scroll", mark],
      ["pointermove", onMove],
    ];
    for (const [name, fn] of events) window.addEventListener(name, fn, { passive: true });

    const tick = setInterval(() => {
      const left = idleTimeoutMs() - (Date.now() - lastActivity.current);
      if (left <= 0) {
        void signOut();
      } else if (left <= WARN_MS) {
        setRemaining(Math.max(1, Math.ceil(left / 1000)));
      } else {
        setRemaining(null);
      }
    }, 1000);

    return () => {
      for (const [name, fn] of events) window.removeEventListener(name, fn);
      clearInterval(tick);
    };
  }, [signOut]);

  if (remaining === null) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="alertdialog" aria-modal="true" aria-label="Inactivity warning">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <Timer className="h-6 w-6 text-amber-500" />
        </div>
        <h2 className="text-base font-bold tracking-tight">Are you still there?</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          No activity has been detected. For security you will be signed out in{" "}
          <span className="font-bold text-foreground tabular-nums">{remaining}s</span>.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => {
              lastActivity.current = Date.now();
              setRemaining(null);
            }}
            className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Stay signed in
          </button>
          <button
            onClick={() => void signOut()}
            className="flex-1 rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-semibold hover:bg-accent transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <LogOut className="h-4 w-4" />
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}

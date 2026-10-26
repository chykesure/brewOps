"use client";

// The owner's private gate. Shift+Alt+B anywhere opens this PIN box; the PIN is
// verified on the server (never embedded in the app) and a dev cookie is minted
// on success. Wrong PINs are throttled by the same brute-force guard as login.
import { useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { devUnlock } from "@/lib/client-api";

export default function DevGate({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  if (!open) return null;
  return <DevGateInner onClose={onClose} onSuccess={onSuccess} />;
}

function DevGateInner({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await devUnlock(pin);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Incorrect PIN.");
      setPin("");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Developer access">
      <div className="w-full max-w-xs rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-center text-base font-bold tracking-tight">Developer Access</h2>
        <p className="mt-1 text-center text-xs text-muted-foreground">Enter your 4-digit developer PIN.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(v);
              setError(null);
            }}
            className="mt-4 w-full rounded-xl border border-border bg-secondary/50 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.5em] outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
            placeholder="····"
            aria-label="Developer PIN"
          />
          {error && <p className="mt-2 text-center text-xs font-semibold text-red-400">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-semibold hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pin.length < 4 || busy}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
            >
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

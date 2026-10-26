"use client";

// The access-license notice: a newly registered artisan CAN sign in, but until
// the owner activates the license from the developer console this popup
// explains the situation. It is a notice, not a wall — the account works.
import { useState } from "react";
import { KeyRound } from "lucide-react";

export default function LicenseNotice({ name, licenseKey }: { name: string; licenseKey: string | null }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="alertdialog" aria-modal="true" aria-label="Account pending activation">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <KeyRound className="h-6 w-6 text-amber-500" />
        </div>
        <h2 className="text-center text-base font-bold tracking-tight">Activate your user access</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Hello {name.split(" ")[0]}, your BrewOps account needs its access license activated.
          You can already look around and work, but please contact the system administrator
          (your Engineering department) to switch the license on for full access.
        </p>
        {licenseKey && (
          <div className="mt-4 rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Your license key</p>
            <p className="mt-0.5 font-mono text-sm font-bold tracking-wider select-all">{licenseKey}</p>
          </div>
        )}
        <button
          onClick={() => setOpen(false)}
          className="mt-5 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          I understand
        </button>
      </div>
    </div>
  );
}

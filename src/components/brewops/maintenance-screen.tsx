"use client";

// Full-screen lockout shown to ARTISANS while the owner has maintenance mode
// switched ON in the dev console. Engineers bypass it entirely. The BrewOps
// logo carries data-dev-trigger so the owner can still reach the private
// console with 7 quick taps (and Shift+Alt+B keeps working as always).
import { Beer, LoaderCircle, LogOut, RefreshCw, Wrench } from "lucide-react";

export default function MaintenanceScreen({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  return (
    <div className="app-backdrop min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center" data-dev-trigger>
          <Beer className="h-8 w-8 text-primary" />
        </div>
        <h1 className="mt-5 text-xl font-bold tracking-tight">Scheduled maintenance</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          BrewOps is briefly offline while the engineering team works on the system.
          Your records are safe — please check back shortly.
        </p>

        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3 text-left">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Wrench className="h-[18px] w-[18px] text-amber-500" />
          </div>
          <div>
            <p className="text-xs font-bold text-amber-500 uppercase tracking-widest">Under maintenance</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Status logging, work orders and reports are paused. Nothing you do now will be lost — the app is simply locked.</p>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={onRefresh}
            className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-1.5"
          >
            {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Try again
          </button>
          <a
            href="/"
            className="flex-1 rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-semibold hover:bg-accent transition-colors inline-flex items-center justify-center gap-1.5"
          >
            <LogOut className="h-4 w-4" />
            Exit
          </a>
        </div>
      </div>
    </div>
  );
}

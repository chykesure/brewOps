"use client";

// Shared building blocks for the Developer Console tabs: byte/time formatters,
// the stat + section cards, and the audit action chip metadata (client-side
// mirror of lib/dev-audit.ts, which is server-only).
import type { ReactNode } from "react";

export function fmtBytes(n: number): string {
  if (!n) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${time}`;
}

export function fmtAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function StatCard({ icon: Icon, label, value, hint }: { icon: typeof import("lucide-react").Gauge; label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export function SectionCard({ icon: Icon, title, desc, children, tone = "default" }: { icon: typeof import("lucide-react").Gauge; title: string; desc: string; children: ReactNode; tone?: "default" | "danger" }) {
  return (
    <section className={`rounded-2xl border bg-card p-5 ${tone === "danger" ? "border-red-500/30" : "border-border"}`}>
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${tone === "danger" ? "bg-red-500/15 text-red-400 border border-red-500/30" : "bg-primary/15 text-primary border border-primary/30"}`}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ---- Audit action chip (client-side mirror of dev-audit.ts) ----

export const DEV_ACTION_META: Record<string, { label: string; cls: string }> = {
  UNLOCK_OK: { label: "Console unlocked", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  UNLOCK_FAIL: { label: "Unlock failed", cls: "border-red-500/40 bg-red-500/10 text-red-400" },
  LOCK: { label: "Console locked", cls: "border-border bg-secondary text-muted-foreground" },
  BACKUP_DB: { label: "Database downloaded", cls: "border-primary/40 bg-primary/10 text-primary" },
  BACKUP_JSON: { label: "Snapshot downloaded", cls: "border-primary/40 bg-primary/10 text-primary" },
  SNAPSHOT_CREATED: { label: "Restore point created", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  SNAPSHOT_RESTORED: { label: "Snapshot restored", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  SNAPSHOT_DELETED: { label: "Restore point deleted", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  RESET_ACTIVITY: { label: "Activity cleared", cls: "border-red-500/40 bg-red-500/10 text-red-400" },
  RESET_FACTORY: { label: "Factory reset", cls: "border-red-500/40 bg-red-500/10 text-red-400" },
  LICENSE_ACTIVATE: { label: "License activated", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  LICENSE_DEACTIVATE: { label: "License deactivated", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  LICENSE_REGENERATE: { label: "Key reissued", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  LICENSE_FILL: { label: "Missing keys issued", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  SESSION_REVOKED: { label: "Session revoked", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  SESSIONS_PURGED: { label: "Sessions purged", cls: "border-red-500/40 bg-red-500/10 text-red-400" },
  DEVICE_REVOKED: { label: "Device revoked", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  MAINTENANCE_ON: { label: "Maintenance ON", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  MAINTENANCE_OFF: { label: "Maintenance OFF", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  AUDIT_CLEARED: { label: "Audit cleared", cls: "border-red-500/40 bg-red-500/10 text-red-400" },
  QUICKSIGNIN_SHOW: { label: "Quick sign-in shown", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  QUICKSIGNIN_HIDE: { label: "Quick sign-in hidden", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
};

export function ActionChip({ action }: { action: string }) {
  const meta = DEV_ACTION_META[action] ?? { label: action, cls: "border-border bg-secondary text-muted-foreground" };
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>;
}

import type { Status } from "@/lib/types";
import {
  AlertTriangle, CircleCheck, FlaskConical, HardHat, Lock, PauseCircle,
  Unplug, Wrench, XCircle, PackageOpen, type LucideIcon,
} from "lucide-react";

export interface StatusMeta {
  label: string;
  short: string;
  desc: string;
  /** tailwind classes for badge: bg + text */
  badge: string;
  /** tailwind classes for big picker button when selected */
  selected: string;
  /** solid color dot */
  dot: string;
  icon: LucideIcon;
  alert: boolean;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "OK";
}

export const STATUS_META: Record<Status, StatusMeta> = {
  WORKING: {
    label: "Working", short: "OK", desc: "Healthy, in normal operation",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    selected: "bg-emerald-500 text-emerald-950 border-emerald-400",
    dot: "bg-emerald-400", icon: CircleCheck, alert: false, severity: "OK",
  },
  STANDBY: {
    label: "Standby", short: "STBY", desc: "Healthy, not needed right now",
    badge: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    selected: "bg-teal-500 text-teal-950 border-teal-400",
    dot: "bg-teal-400", icon: PauseCircle, alert: false, severity: "OK",
  },
  SIMULATION: {
    label: "Simulation", short: "SIM", desc: "Reading is simulated, not real",
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    selected: "bg-violet-500 text-violet-950 border-violet-400",
    dot: "bg-violet-400", icon: FlaskConical, alert: true, severity: "CRITICAL",
  },
  BYPASS: {
    label: "Bypass", short: "BYPS", desc: "Forced out of auto control",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    selected: "bg-amber-500 text-amber-950 border-amber-400",
    dot: "bg-amber-400", icon: Unplug, alert: true, severity: "CRITICAL",
  },
  FAULTY: {
    label: "Faulty", short: "FLT", desc: "Runs but misbehaving",
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    selected: "bg-orange-500 text-orange-950 border-orange-400",
    dot: "bg-orange-400", icon: AlertTriangle, alert: true, severity: "HIGH",
  },
  MAINTENANCE: {
    label: "Maintenance", short: "MAINT", desc: "Actively being worked on",
    badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    selected: "bg-cyan-500 text-cyan-950 border-cyan-400",
    dot: "bg-cyan-400", icon: Wrench, alert: false, severity: "OK",
  },
  AWAITING_SPARES: {
    label: "Awaiting Spares", short: "SPARES", desc: "Down, parts not in store",
    badge: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
    selected: "bg-fuchsia-500 text-fuchsia-950 border-fuchsia-400",
    dot: "bg-fuchsia-400", icon: PackageOpen, alert: true, severity: "HIGH",
  },
  BROKEN: {
    label: "Broken", short: "BRK", desc: "Failed, out of service",
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    selected: "bg-red-500 text-red-950 border-red-400",
    dot: "bg-red-500", icon: XCircle, alert: true, severity: "CRITICAL",
  },
  LOTO: {
    label: "Isolated / LOTO", short: "LOTO", desc: "Locked & tagged, may not start",
    badge: "bg-zinc-700/40 text-zinc-200 border-yellow-500/40",
    selected: "bg-zinc-950 text-yellow-400 border-yellow-500",
    dot: "bg-zinc-950 ring-1 ring-yellow-400", icon: Lock, alert: true, severity: "CRITICAL",
  },
  COMMISSIONING: {
    label: "Commissioning", short: "COMM", desc: "New install, on trial",
    badge: "bg-lime-500/15 text-lime-300 border-lime-500/30",
    selected: "bg-lime-500 text-lime-950 border-lime-400",
    dot: "bg-lime-400", icon: HardHat, alert: false, severity: "OK",
  },
};

export const PICKER_ORDER: Status[] = [
  "WORKING", "STANDBY", "MAINTENANCE", "COMMISSIONING",
  "SIMULATION", "BYPASS", "FAULTY", "AWAITING_SPARES", "BROKEN", "LOTO",
];

export const WO_STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  ACCEPTED: { label: "Accepted", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  IN_PROGRESS: { label: "In Progress", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  COMPLETED: { label: "Completed", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  CANCELLED: { label: "Cancelled", cls: "bg-zinc-600/20 text-zinc-400 border-zinc-600/30" },
};

export const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  LOW: { label: "Low", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  NORMAL: { label: "Normal", cls: "bg-zinc-400/15 text-zinc-200 border-zinc-400/25" },
  HIGH: { label: "High", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  URGENT: { label: "Urgent", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
};

/** Artisan trades — artisans are categorised into Mechanical and Electrical */
export const TRADE_META: Record<string, { label: string; code: string; cls: string; dot: string }> = {
  MECHANICAL: { label: "Mechanical", code: "B-MA", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", dot: "bg-amber-400" },
  ELECTRICAL: { label: "Electrical", code: "B-EA", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30", dot: "bg-sky-400" },
};

export function tradeMeta(trade?: string | null) {
  return TRADE_META[trade ?? ""] ?? null;
}

export const FREQUENCY_CHIP: Record<string, string> = {
  DAILY: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  WEEKLY: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  BIWEEKLY: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  THREE_WEEKLY: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  MONTHLY: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  QUARTERLY: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  HALFYEARLY: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  YEARLY: "bg-red-500/15 text-red-300 border-red-500/30",
};

/** Evidence-chain verification states — shown on work orders and the signed record */
export const VERIFICATION_META: Record<string, { label: string; short: string; cls: string }> = {
  PENDING: { label: "Awaiting check-in", short: "CHECK-IN", cls: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  VERIFIED: { label: "On-site verified", short: "VERIFIED", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  FLAGGED: { label: "Evidence flagged", short: "FLAGGED", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  OVERRIDE: { label: "Supervisor override", short: "OVERRIDE", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
};

export const CHECKIN_METHOD_LABEL: Record<string, string> = {
  QR: "QR sticker scan",
  CODE: "Nameplate number",
  GPS: "GPS geofence",
};

/** 12 m / 1.2 km formatting for GPS evidence */
export function fmtDistance(m: number | null | undefined): string {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}
export function isOverdue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}
export function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function pmCycleLabel(cycle: string, day: number): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  switch (cycle) {
    case "DAILY": return "Daily";
    case "WEEKLY": return `Weekly (${names[day % 7]})`;
    case "MONTHLY": return `Monthly (day ${day})`;
    default: return "No PM schedule";
  }
}

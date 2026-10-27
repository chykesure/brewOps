// Server-only audit writer for the developer console. Every sensitive owner
// operation (backups, restores, resets, license flips, session revocations,
// maintenance toggles, console unlock attempts) lands in the DevEvent table so
// the console's Audit tab can answer "who did what, when" after the fact.
// Auditing must NEVER break the operation it records — failures are swallowed.
import "server-only";
import { db } from "@/lib/db";

export const DEV_ACTIONS = [
  "UNLOCK_OK", "UNLOCK_FAIL", "LOCK",
  "BACKUP_DB", "BACKUP_JSON",
  "SNAPSHOT_CREATED", "SNAPSHOT_RESTORED", "SNAPSHOT_DELETED",
  "RESET_ACTIVITY", "RESET_FACTORY",
  "LICENSE_ACTIVATE", "LICENSE_DEACTIVATE", "LICENSE_REGENERATE", "LICENSE_FILL",
  "SYNC_PASSWORD_SET", "SYNC_PASSWORD_REGENERATE",
  "SESSION_REVOKED", "SESSIONS_PURGED", "DEVICE_REVOKED",
  "MAINTENANCE_ON", "MAINTENANCE_OFF", "AUDIT_CLEARED",
  "QUICKSIGNIN_SHOW", "QUICKSIGNIN_HIDE",
  "DATA_CLEARED",
] as const;

export type DevAction = (typeof DEV_ACTIONS)[number];

export async function logDevEvent(action: DevAction, detail?: string): Promise<void> {
  try {
    await db.devEvent.create({ data: { action, detail: detail?.slice(0, 500) ?? null } });
  } catch {
    // never let the audit write break the console operation itself
  }
}

/** Human-friendly label + tone for each audit action (client mirrors this). */
export function devActionMeta(action: string): { label: string; tone: "ok" | "warn" | "danger" | "info" } {
  switch (action) {
    case "UNLOCK_OK": return { label: "Console unlocked", tone: "ok" };
    case "UNLOCK_FAIL": return { label: "Unlock failed", tone: "danger" };
    case "LOCK": return { label: "Console locked", tone: "info" };
    case "BACKUP_DB": return { label: "Database downloaded", tone: "info" };
    case "BACKUP_JSON": return { label: "JSON snapshot downloaded", tone: "info" };
    case "SNAPSHOT_CREATED": return { label: "Restore point created", tone: "ok" };
    case "SNAPSHOT_RESTORED": return { label: "Snapshot restored", tone: "warn" };
    case "SNAPSHOT_DELETED": return { label: "Restore point deleted", tone: "warn" };
    case "RESET_ACTIVITY": return { label: "Activity data cleared", tone: "danger" };
    case "RESET_FACTORY": return { label: "Factory reset", tone: "danger" };
    case "LICENSE_ACTIVATE": return { label: "License activated", tone: "ok" };
    case "LICENSE_DEACTIVATE": return { label: "License deactivated", tone: "warn" };
    case "LICENSE_REGENERATE": return { label: "License key reissued", tone: "warn" };
    case "LICENSE_FILL": return { label: "Missing keys issued", tone: "ok" };
    case "SYNC_PASSWORD_SET": return { label: "Sync password set", tone: "warn" };
    case "SYNC_PASSWORD_REGENERATE": return { label: "Sync password reissued", tone: "warn" };
    case "DATA_CLEARED": return { label: "Selective data wipe", tone: "danger" };
    case "SESSION_REVOKED": return { label: "Session revoked", tone: "warn" };
    case "SESSIONS_PURGED": return { label: "Sessions purged", tone: "danger" };
    case "DEVICE_REVOKED": return { label: "Device revoked", tone: "warn" };
    case "MAINTENANCE_ON": return { label: "Maintenance mode ON", tone: "warn" };
    case "MAINTENANCE_OFF": return { label: "Maintenance mode OFF", tone: "ok" };
    case "AUDIT_CLEARED": return { label: "Audit trail cleared", tone: "danger" };
    case "QUICKSIGNIN_SHOW": return { label: "Quick sign-in shown", tone: "ok" };
    case "QUICKSIGNIN_HIDE": return { label: "Quick sign-in hidden", tone: "warn" };
    default: return { label: action, tone: "info" };
  }
}
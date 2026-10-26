// Server-only data operations for the developer console: JSON snapshot,
// snapshot restore, activity purge and factory reset. Every operation runs
// inside one transaction and follows the exact foreign-key-safe table order.
import "server-only";
import { db } from "@/lib/db";

type DateFieldList = readonly string[];
interface ModelSpec {
  key: string; // key inside the backup JSON
  table: string; // prisma delegate name (lowerCamel)
  dates: DateFieldList; // DateTime fields to revive from ISO strings
}

// ---- Backup layout: every table, with its date columns --------------------
export const BACKUP_MODELS: ModelSpec[] = [
  { key: "settings",      table: "settings",      dates: [] },
  { key: "branches",      table: "branch",        dates: ["createdAt"] },
  { key: "departments",   table: "department",    dates: [] },
  { key: "users",         table: "user",          dates: ["pwdChangedAt", "createdAt", "updatedAt"] },
  { key: "devices",       table: "device",        dates: ["approvedAt", "lastSeenAt", "createdAt"] },
  { key: "sessions",      table: "session",       dates: ["createdAt", "lastSeenAt", "expiresAt", "revokedAt"] },
  { key: "securityEvents",table: "securityEvent", dates: ["createdAt"] },
  { key: "devEvents",     table: "devEvent",      dates: ["createdAt"] },
  { key: "machines",      table: "machine",       dates: ["createdAt", "updatedAt"] },
  { key: "parts",         table: "part",          dates: ["createdAt", "updatedAt"] },
  { key: "components",    table: "component",     dates: ["createdAt", "updatedAt"] },
  { key: "pmTemplates",   table: "pmTemplate",    dates: ["nextDueAt", "lastRunAt", "createdAt"] },
  { key: "pmOperations",  table: "pmOperation",   dates: [] },
  { key: "workOrders",    table: "workOrder",     dates: ["dueDate", "startedAt", "completedAt", "acknowledgedAt", "checkInAt", "lastNudgeAt", "createdAt", "updatedAt"] },
  { key: "woSteps",       table: "woStep",        dates: ["doneAt"] },
  { key: "woCheckIns",    table: "woCheckIn",     dates: ["createdAt"] },
  { key: "statusLogs",    table: "statusLog",     dates: ["createdAt"] },
  { key: "downtimes",     table: "downtime",      dates: ["startedAt", "endedAt"] },
  { key: "escalations",   table: "escalation",    dates: ["handledAt", "createdAt", "updatedAt"] },
  { key: "sequences",     table: "seq",           dates: [] },
];

// ---- Delete order (children before parents; SQLite enforces the FKs) ------
const DELETE_ORDER: { key: string; table: string }[] = [
  { key: "devEvents",      table: "devEvent" },
  { key: "securityEvents", table: "securityEvent" },
  { key: "woCheckIns",     table: "woCheckIn" },
  { key: "woSteps",        table: "woStep" },
  { key: "escalations",    table: "escalation" },
  { key: "statusLogs",     table: "statusLog" },
  { key: "downtimes",      table: "downtime" },
  { key: "workOrders",     table: "workOrder" },
  { key: "pmOperations",   table: "pmOperation" },
  { key: "pmTemplates",    table: "pmTemplate" },
  { key: "components",     table: "component" },
  { key: "parts",          table: "part" },
  { key: "machines",       table: "machine" },
  { key: "departments",    table: "department" },
  { key: "branches",       table: "branch" },
  { key: "sessions",       table: "session" },
  { key: "devices",        table: "device" },
  { key: "users",          table: "user" },
  { key: "sequences",      table: "seq" },
  { key: "settings",       table: "settings" },
];

function delegate(name: string): { deleteMany: (a?: unknown) => Promise<{ count: number }>; createMany: (a: unknown) => Promise<{ count: number }>; findMany: (a?: unknown) => Promise<Record<string, unknown>[]> } {
  return (db as unknown as Record<string, { deleteMany: (a?: unknown) => Promise<{ count: number }>; createMany: (a: unknown) => Promise<{ count: number }>; findMany: (a?: unknown) => Promise<Record<string, unknown>[]> }>)[name];
}

function revive(rows: Record<string, unknown>[], dates: DateFieldList): Record<string, unknown>[] {
  if (!dates.length) return rows;
  return rows.map((r) => {
    const out = { ...r };
    for (const f of dates) {
      const v = out[f];
      if (typeof v === "string") out[f] = new Date(v);
    }
    return out;
  });
}

// ---- GET: full JSON snapshot ------------------------------------------------
export async function snapshotAll(): Promise<{ data: Record<string, Record<string, unknown>[]>; counts: Record<string, number> }> {
  const data: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const m of BACKUP_MODELS) {
    const rows = await delegate(m.table).findMany({});
    data[m.key] = rows;
    counts[m.key] = rows.length;
  }
  return { data, counts };
}

// ---- POST: restore from a JSON snapshot -------------------------------------
export async function restoreSnapshot(backup: unknown): Promise<Record<string, number>> {
  const b = backup as { app?: string; version?: number; data?: Record<string, unknown> };
  if (!b || b.app !== "BrewOps" || b.version !== 1 || typeof b.data !== "object" || b.data === null) {
    throw new Error("This file is not a BrewOps JSON backup (v1).");
  }
  const restored: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    // Full wipe in the SAME children-first order (never reversed — SQLite
    // enforces the FKs), detaching users before the departments they point at.
    for (const d of DELETE_ORDER) {
      if (d.table === "department") {
        await tx.user.updateMany({ data: { departmentId: null, branchId: null } });
      }
      await (tx as any)[d.table].deleteMany({});
    }
    for (const m of BACKUP_MODELS) {
      const rows = b.data?.[m.key];
      if (!Array.isArray(rows)) continue; // missing section = restore nothing for it
      const clean = revive(rows as Record<string, unknown>[], m.dates);
      for (let i = 0; i < clean.length; i += 80) {
        // NOTE: Prisma's SQLite createMany does not accept skipDuplicates —
        // the tables were just wiped inside this transaction, so there is
        // nothing to duplicate anyway.
        await (tx as any)[m.table].createMany({ data: clean.slice(i, i + 80) });
      }
      restored[m.key] = clean.length;
    }
  });
  return restored;
}

// ---- POST: activity purge (status logs, work orders, downtime, feedback) ----
export async function purgeActivity(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    for (const t of ["woCheckIn", "woStep", "escalation", "statusLog", "downtime", "workOrder"] as const) {
      const r = await (tx as any)[t].deleteMany({});
      out[t] = r.count;
    }
  });
  return out;
}

// ---- POST: factory reset -----------------------------------------------------
// Wipes ALL operational and asset data but keeps the plant running for the
// owner: ADMIN accounts survive (with their trusted devices and sessions, so
// the owner is not thrown out), and the org identity (Settings) survives.
export async function factoryReset(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    // 1. operational + asset data, children first
    for (const t of ["woCheckIn", "woStep", "escalation", "statusLog", "downtime", "workOrder", "pmOperation", "pmTemplate", "component", "part", "machine"] as const) {
      out[t] = await (tx as any)[t].deleteMany({}).then((r: { count: number }) => r.count);
    }
    // 2. detach the surviving admin accounts from departments/branches, then
    //    wipe the structure (department rows are referenced by kept users)
    await tx.user.updateMany({ data: { departmentId: null, branchId: null } });
    out.departments = (await tx.department.deleteMany({})).count;
    out.branches = (await tx.branch.deleteMany({})).count;
    // 3. artisan accounts go; the ADMIN (owner) stays signed in
    out.sessions = (await tx.session.deleteMany({ where: { user: { role: { not: "ADMIN" } } } })).count;
    out.devices = (await tx.device.deleteMany({ where: { user: { role: { not: "ADMIN" } } } })).count;
    out.users = (await tx.user.deleteMany({ where: { role: { not: "ADMIN" } } })).count;
    out.securityEvents = (await tx.securityEvent.deleteMany({})).count;
    out.sequences = (await tx.seq.deleteMany({})).count;
  });
  return out;
}

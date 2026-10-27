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

// ---- Selective wipes (dev console → Data → "Selective wipe") -----------------
// The owner picks ONE kind of data and clears only that. Every operation runs
// in one transaction, children before parents (SQLite enforces the FKs), and
// reports exactly how many rows of each table went away.

/** Live row counts for every selectable entity — powers the impact preview. */
export async function clearCounts(): Promise<Record<string, number>> {
  const [
    statusLogs, workOrders, escalations, downtimes, pmTemplates,
    components, machines, parts, users, sessions, devices, securityEvents,
  ] = await Promise.all([
    db.statusLog.count(),
    db.workOrder.count(),
    db.escalation.count(),
    db.downtime.count(),
    db.pmTemplate.count(),
    db.component.count(),
    db.machine.count(),
    db.part.count(),
    db.user.count({ where: { role: { not: "ADMIN" } } }),
    db.session.count(),
    db.device.count(),
    db.securityEvent.count(),
  ]);
  return {
    statusLogs, workOrders, escalations, downtimes,
    pmPlans: pmTemplates, components, machines, parts,
    users, sessions, devices, securityEvents,
  };
}

/** Machines with their component counts — powers the per-machine wipe picker. */
export async function machineClearList(): Promise<{ id: string; code: string; name: string; department: string; components: number }[]> {
  const machines = await db.machine.findMany({
    select: {
      id: true, code: true, name: true,
      department: { select: { name: true } },
      _count: { select: { components: true } },
    },
    orderBy: { code: "asc" },
  });
  return machines.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    department: m.department.name,
    components: m._count.components,
  }));
}

/**
 * Clears ONE selectable entity. `machineId` scopes the two machine-targeted
 * entities (machineComponents / machine) to a single machine.
 */
export async function clearEntity(entity: string, machineId?: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    switch (entity) {
      case "statusLogs":
        out.statusLogs = (await tx.statusLog.deleteMany({})).count;
        break;

      case "workOrders": // orders + their evidence chain; feedback linked to them closes too
        out.escalations = (await tx.escalation.deleteMany({ where: { workOrderId: { not: null } } })).count;
        out.woCheckIns = (await tx.woCheckIn.deleteMany({})).count;
        out.woSteps = (await tx.woStep.deleteMany({})).count;
        out.workOrders = (await tx.workOrder.deleteMany({})).count;
        break;

      case "escalations":
        out.escalations = (await tx.escalation.deleteMany({})).count;
        break;

      case "downtimes":
        out.downtimes = (await tx.downtime.deleteMany({})).count;
        break;

      case "pmPlans":
        out.pmOperations = (await tx.pmOperation.deleteMany({})).count;
        out.pmPlans = (await tx.pmTemplate.deleteMany({})).count;
        break;

      case "components": // every component plant-wide — their history goes with them
        out.statusLogs = (await tx.statusLog.deleteMany({})).count;
        out.components = (await tx.component.deleteMany({})).count;
        break;

      case "parts": // spare parts; components keep existing but lose the link
        await tx.component.updateMany({ data: { partId: null } });
        out.parts = (await tx.part.deleteMany({})).count;
        break;

      case "machines": // the whole asset register: machines + components + plans + their history
        out.escalations = (await tx.escalation.deleteMany({})).count;
        out.woCheckIns = (await tx.woCheckIn.deleteMany({})).count;
        out.woSteps = (await tx.woStep.deleteMany({})).count;
        out.workOrders = (await tx.workOrder.deleteMany({})).count;
        out.statusLogs = (await tx.statusLog.deleteMany({})).count;
        out.downtimes = (await tx.downtime.deleteMany({})).count;
        out.pmOperations = (await tx.pmOperation.deleteMany({})).count;
        out.pmPlans = (await tx.pmTemplate.deleteMany({})).count;
        out.components = (await tx.component.deleteMany({})).count;
        out.machines = (await tx.machine.deleteMany({})).count;
        break;

      case "users": { // artisan accounts only — engineer (ADMIN) accounts survive
        const arts = await tx.user.findMany({ where: { role: { not: "ADMIN" } }, select: { id: true } });
        const ids = arts.map((a) => a.id);
        if (!ids.length) break;
        out.sessions = (await tx.session.deleteMany({ where: { userId: { in: ids } } })).count;
        out.devices = (await tx.device.deleteMany({ where: { userId: { in: ids } } })).count;
        out.statusLogs = (await tx.statusLog.deleteMany({ where: { userId: { in: ids } } })).count;
        out.woCheckIns = (await tx.woCheckIn.deleteMany({ where: { userId: { in: ids } } })).count;
        out.downtimes = (await tx.downtime.deleteMany({ where: { reportedById: { in: ids } } })).count;
        out.escalations = (await tx.escalation.deleteMany({
          where: { OR: [{ raisedById: { in: ids } }, { handledById: { in: ids } }, { reroutedToId: { in: ids } }] },
        })).count;
        // work orders CREATED by artisans are deleted outright; orders merely
        // ASSIGNED to them survive, just unassigned
        const theirWos = await tx.workOrder.findMany({ where: { createdById: { in: ids } }, select: { id: true } });
        const woIds = theirWos.map((w) => w.id);
        if (woIds.length) {
          out.escalations = (out.escalations ?? 0) + (await tx.escalation.deleteMany({ where: { workOrderId: { in: woIds } } })).count;
          out.woSteps = (await tx.woStep.deleteMany({ where: { workOrderId: { in: woIds } } })).count;
          out.woCheckIns = (out.woCheckIns ?? 0) + (await tx.woCheckIn.deleteMany({ where: { workOrderId: { in: woIds } } })).count;
          out.workOrders = (await tx.workOrder.deleteMany({ where: { id: { in: woIds } } })).count;
        }
        await tx.workOrder.updateMany({ where: { assignedToId: { in: ids } }, data: { assignedToId: null } });
        await tx.machine.updateMany({ where: { ownerId: { in: ids } }, data: { ownerId: null } });
        out.users = (await tx.user.deleteMany({ where: { id: { in: ids } } })).count;
        break;
      }

      case "sessions": // kick everyone back to the login screen (devices stay trusted)
        out.sessions = (await tx.session.deleteMany({})).count;
        break;

      case "devices": // forget every synchronized phone/PC → password asked again on next login
        out.devices = (await tx.device.deleteMany({})).count;
        break;

      case "securityEvents":
        out.securityEvents = (await tx.securityEvent.deleteMany({})).count;
        break;

      case "machineComponents": { // one machine: components + their status history + related feedback
        if (!machineId) throw new Error("machineId is required.");
        const comps = await tx.component.findMany({ where: { machineId }, select: { id: true } });
        const cids = comps.map((c) => c.id);
        out.statusLogs = cids.length ? (await tx.statusLog.deleteMany({ where: { componentId: { in: cids } } })).count : 0;
        out.escalations = cids.length ? (await tx.escalation.deleteMany({ where: { componentId: { in: cids } } })).count : 0;
        out.components = (await tx.component.deleteMany({ where: { machineId } })).count;
        break;
      }

      case "machine": { // one machine ENTIRELY: its orders, plans, history, components, then the machine
        if (!machineId) throw new Error("machineId is required.");
        out.escalations = (await tx.escalation.deleteMany({ where: { machineId } })).count;
        out.woCheckIns = (await tx.woCheckIn.deleteMany({ where: { machineId } })).count;
        const wos = await tx.workOrder.findMany({ where: { machineId }, select: { id: true } });
        out.woSteps = wos.length ? (await tx.woStep.deleteMany({ where: { workOrderId: { in: wos.map((w) => w.id) } } })).count : 0;
        out.workOrders = (await tx.workOrder.deleteMany({ where: { machineId } })).count;
        const comps = await tx.component.findMany({ where: { machineId }, select: { id: true } });
        const cids = comps.map((c) => c.id);
        out.statusLogs = cids.length ? (await tx.statusLog.deleteMany({ where: { componentId: { in: cids } } })).count : 0;
        out.downtimes = (await tx.downtime.deleteMany({ where: { machineId } })).count;
        out.pmOperations = (await tx.pmOperation.deleteMany({ where: { template: { machineId } } })).count;
        out.pmPlans = (await tx.pmTemplate.deleteMany({ where: { machineId } })).count;
        out.components = (await tx.component.deleteMany({ where: { machineId } })).count;
        out.machines = (await tx.machine.deleteMany({ where: { id: machineId } })).count;
        break;
      }

      default:
        throw new Error("Unknown data entity.");
    }
  });
  return out;
}
// Server-only PM scheduler — generates PM work orders from:
//   1. Digitised PM plan templates (PmTemplate — the paper WO templates)
//   2. Legacy per-machine pmCycle settings (kept for backwards compatibility)
import "server-only";
import { db } from "@/lib/db";
import { FREQUENCY_META, isFrequency, type PmFrequency, type Trade } from "@/lib/types";

const PM_STEPS = [
  "Visual inspection: leaks, unusual noise, vibration",
  "Check & record operating parameters",
  "Check lubrication level & condition",
  "Inspect seals, couplings & fasteners",
  "Verify guards & safety devices in place",
  "Test run & confirm normal operation",
];

const SAFETY_PREAMBLE =
  "Safety is your responsibility. Use Personal Protective Equipment, follow all Lockout, Permit and Safety instructions when applicable. DO NOT proceed unless you have received basic safety induction training.";

function endOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d = new Date()): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}
function startOfMonth(d = new Date()): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  const day = x.getDate();
  x.setMonth(x.getMonth() + months);
  if (x.getDate() < day) x.setDate(0); // clamp e.g. Jan 31 → Feb 28
  return x;
}

/** Advance a date by the plan's interval. */
function nextDue(from: Date, frequency: PmFrequency): Date {
  switch (frequency) {
    case "DAILY": return new Date(from.getTime() + 1 * 86400_000);
    case "WEEKLY": return new Date(from.getTime() + 7 * 86400_000);
    case "BIWEEKLY": return new Date(from.getTime() + 14 * 86400_000);
    case "THREE_WEEKLY": return new Date(from.getTime() + 21 * 86400_000);
    case "MONTHLY": return addMonths(from, 1);
    case "QUARTERLY": return addMonths(from, 3);
    case "HALFYEARLY": return addMonths(from, 6);
    case "YEARLY": return addMonths(from, 12);
  }
}

async function nextWoCode(): Promise<string> {
  const seq = await db.seq.upsert({
    where: { key: "WO" },
    create: { key: "WO", value: 1001 },
    update: { value: { increment: 1 } },
  });
  return `WO-${seq.value}`;
}

export interface SchedulerResult {
  created: { code: string; machine: string; cycle: string }[];
  skipped: number;
}

/** Pick the best artisan for a plan: machine owner if trade matches, else least-loaded artisan of that trade. */
async function pickAssignee(
  machineOwnerId: string | null,
  ownerTrade: string | null,
  trade: Trade
): Promise<string | null> {
  if (machineOwnerId && ownerTrade === trade) return machineOwnerId;
  const candidates = await db.user.findMany({
    where: { role: "ARTISAN", active: true, trade },
    include: { assignedWorkOrders: { where: { status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS"] } }, select: { id: true } } },
  });
  if (candidates.length === 0) return machineOwnerId; // fall back to owner regardless of trade
  candidates.sort((a, b) => a.assignedWorkOrders.length - b.assignedWorkOrders.length);
  return candidates[0].id;
}

/** Generate PM work orders from digitised maintenance plans (templates). */
async function runTemplatePlans(now: Date, systemAdminId: string, result: SchedulerResult) {
  const templates = await db.pmTemplate.findMany({
    where: { active: true },
    include: { machine: { include: { owner: true } }, operations: { orderBy: { idx: "asc" } } },
  });

  for (const t of templates) {
    if (t.operations.length === 0) { result.skipped++; continue; }
    if (t.nextDueAt.getTime() > now.getTime()) { result.skipped++; continue; }

    const freq: PmFrequency = isFrequency(t.frequency) ? t.frequency : "MONTHLY";
    const due = endOfDay(t.nextDueAt);

    // De-duplicate + generate inside one transaction so concurrent bootstrap ticks cannot double-create
    const created = await db.$transaction(async (tx) => {
      const openWo = await tx.workOrder.findFirst({
        where: { templateId: t.id, status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS"] } },
      });
      if (openWo) {
        // Previous round still open — push the plan forward instead of piling up orders
        await tx.pmTemplate.update({ where: { id: t.id }, data: { nextDueAt: nextDue(now, freq), lastRunAt: now } });
        return null;
      }
      const fresh = await tx.pmTemplate.findUnique({ where: { id: t.id } });
      if (!fresh || !fresh.active || fresh.nextDueAt.getTime() > now.getTime()) return null;

      // Flatten operations into steps, keeping the SAP operation structure (0010, 0020 …)
      const stepData = t.operations.flatMap((op) =>
        op.tasks
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((text, i) => ({
            idx: 0, // assigned below after flatMap ordering
            text,
            opIdx: op.idx,
            opName: op.subAssembly,
            _order: op.idx * 1000 + i,
            _trade: op.trade,
          }))
      ).sort((a, b) => a._order - b._order).map((s, i) => ({
        idx: i + 1,
        text: s.text,
        opIdx: s.opIdx,
        opName: s.opName,
      }));

      // Dominant trade = trade of the majority of operations, fallback to plan trade
      const tradeCount: Record<string, number> = {};
      for (const op of t.operations) tradeCount[op.trade] = (tradeCount[op.trade] ?? 0) + op.tasks.split("\n").filter(Boolean).length;
      const dominant = (Object.entries(tradeCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? t.trade) as Trade;

      const assignee = await pickAssigneeTx(tx, t.machine.ownerId, t.machine.owner?.trade ?? null, dominant);

      const seq = await tx.seq.upsert({
        where: { key: "WO" },
        create: { key: "WO", value: 1001 },
        update: { value: { increment: 1 } },
      });
      const code = `WO-${seq.value}`;

      await tx.workOrder.create({
        data: {
          code,
          title: t.title,
          description: `Maintenance Plan ${t.code} · ${FREQUENCY_META[freq].label} PM · ${SAFETY_PREAMBLE}`,
          type: "PM",
          priority: t.priority,
          source: "PM_PLAN",
          frequency: freq,
          machineId: t.machineId,
          templateId: t.id,
          assignedToId: assignee,
          createdById: systemAdminId,
          status: "PENDING",
          dueDate: due,
          steps: { create: stepData },
        },
      });

      await tx.pmTemplate.update({
        where: { id: t.id },
        data: { lastRunAt: now, nextDueAt: nextDue(now, freq) },
      });
      return code;
    });

    if (created) {
      result.created.push({ code: created, machine: `${t.machine.code} ${t.machine.name}`, cycle: FREQUENCY_META[freq].label });
    } else {
      result.skipped++;
    }
  }
}

// Transaction-scoped assignee picker (same policy as pickAssignee)
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
async function pickAssigneeTx(tx: Tx, machineOwnerId: string | null, ownerTrade: string | null, trade: Trade): Promise<string | null> {
  if (machineOwnerId && ownerTrade === trade) return machineOwnerId;
  const candidates = await tx.user.findMany({
    where: { role: "ARTISAN", active: true, trade },
    include: { assignedWorkOrders: { where: { status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS"] } }, select: { id: true } } },
  });
  if (candidates.length === 0) return machineOwnerId;
  candidates.sort((a, b) => a.assignedWorkOrders.length - b.assignedWorkOrders.length);
  return candidates[0].id;
}

/** Legacy: per-machine pmCycle generation (machines without a plan still get a generic PM). */
async function runMachineCycles(now: Date, systemAdminId: string, result: SchedulerResult) {
  const machines = await db.machine.findMany({
    where: { active: true, pmCycle: { not: "NONE" } },
    include: { department: true, owner: true, pmTemplates: true },
  });

  for (const m of machines) {
    // Machines managed by a digitised plan no longer need the legacy cycle
    if (m.pmTemplates.some((t) => t.active)) { result.skipped++; continue; }

    let shouldRun = false;
    let cycleLabel = "";

    if (m.pmCycle === "DAILY") {
      shouldRun = true;
      cycleLabel = "Daily";
    } else if (m.pmCycle === "WEEKLY") {
      const isoDow = now.getDay() === 0 ? 7 : now.getDay();
      shouldRun = isoDow === m.pmDay;
      cycleLabel = "Weekly";
    } else if (m.pmCycle === "MONTHLY") {
      shouldRun = now.getDate() === m.pmDay;
      cycleLabel = "Monthly";
    }

    if (!shouldRun) { result.skipped++; continue; }

    const periodStart =
      m.pmCycle === "DAILY" ? startOfDay(now) : m.pmCycle === "WEEKLY" ? startOfWeek(now) : startOfMonth(now);
    const existing = await db.workOrder.findFirst({
      where: {
        machineId: m.id, type: "PM", source: { not: "PM_PLAN" },
        dueDate: { gte: periodStart, lte: endOfDay(now) },
        status: { not: "CANCELLED" },
      },
    });
    if (existing) { result.skipped++; continue; }

    const code = await nextWoCode();
    await db.workOrder.create({
      data: {
        code,
        title: `${m.name} · ${cycleLabel} PM`,
        type: "PM",
        priority: "NORMAL",
        source: "SCHEDULER",
        machineId: m.id,
        assignedToId: m.ownerId,
        createdById: systemAdminId,
        status: "PENDING",
        dueDate: endOfDay(now),
        steps: { create: PM_STEPS.map((text, i) => ({ idx: i + 1, text })) },
      },
    });
    result.created.push({ code, machine: `${m.code} ${m.name}`, cycle: cycleLabel });
  }
}

export async function runScheduler(): Promise<SchedulerResult> {
  const now = new Date();
  const result: SchedulerResult = { created: [], skipped: 0 };
  const systemAdmin = await db.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (!systemAdmin) return result;

  await runTemplatePlans(now, systemAdmin.id, result);
  await runMachineCycles(now, systemAdmin.id, result);
  return result;
}

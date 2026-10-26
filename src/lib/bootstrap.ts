// Server-only bootstrap builder — one call returns the whole role-aware app state
import "server-only";
import { db } from "@/lib/db";
import { runScheduler } from "@/lib/scheduler";
import { readOrg } from "@/lib/org";
import {
  ALERTING_STATUSES, CRITICAL_STATUSES, isFrequency, isEscalationCategory,
  ESCALATION_META,
  type AlertItem, type BootstrapData, type ComponentDTO, type DowntimeDTO,
  type EscalationDTO, type EscalationCategory,
  type MachineDTO, type PmFrequency, type PmOperationDTO, type PmTemplateDTO,
  type StatsDTO, type Status, type StatusLogDTO,
  type UserDTO, type WorkOrderDTO, type WoType, type Priority, type WoStatus, type PmCycle,
} from "@/lib/types";
import { toUserDTO } from "@/lib/session";
import { zonedDayBounds } from "@/lib/time";
import type { Component, Machine, User, WoStep, WorkOrder, Part } from "@prisma/client";

function mapLog(l: { id: string; status: string; note: string | null; photo: string | null; distanceM?: number | null; userId: string; createdAt: Date; user: User }): StatusLogDTO {
  return {
    id: l.id, status: l.status as Status, note: l.note, photo: l.photo,
    distanceM: l.distanceM ?? null,
    userId: l.userId, userName: l.user.name, createdAt: l.createdAt.toISOString(),
  };
}

type LogWithUser = { id: string; status: string; note: string | null; photo: string | null; distanceM: number | null; userId: string; createdAt: Date; user: User };
function mapComponent(c: Component & { statusLogs?: LogWithUser[] }, latestLog?: LogWithUser | null): ComponentDTO {
  const logs = "statusLogs" in c && Array.isArray(c.statusLogs) ? c.statusLogs : [];
  const last = latestLog ?? logs[0];
  return {
    id: c.id, machineId: c.machineId, name: c.name, partCode: c.partCode,
    category: c.category, currentStatus: c.currentStatus as Status,
    updatedAt: c.updatedAt.toISOString(),
    lastLog: last ? mapLog(last) : null,
  };
}

function mapMachine(m: Machine & { department: { name: string }; owner?: User | null; components: ComponentDTO[] }, opts?: { admin?: boolean }): MachineDTO {
  return {
    id: m.id, code: m.code, name: m.name,
    departmentId: m.departmentId, departmentName: m.department.name,
    location: m.location, functionalLoc: m.functionalLoc ?? null, equipmentNo: m.equipmentNo ?? null,
    pmCycle: m.pmCycle as PmCycle, pmDay: m.pmDay,
    lat: m.lat ?? null, lng: m.lng ?? null, geoRadiusM: m.geoRadiusM ?? 150,
    checkinCode: opts?.admin ? (m.checkinCode ?? null) : null, // nameplate code never leaves the server for artisans
    ownerId: m.ownerId, ownerName: m.owner?.name ?? null,
    components: m.components,
  };
}

type WoFull = WorkOrder & { machine: Machine; assignedTo: User | null; createdBy: User; acknowledgedBy?: User | null; steps: WoStep[]; template?: { code: string } | null; checkIns?: unknown[]; _count?: { checkIns: number } };
function mapWo(w: WoFull): WorkOrderDTO {
  let evidence: string[] = [];
  try { evidence = w.evidence ? (JSON.parse(w.evidence) as string[]) : []; } catch { evidence = []; }
  return {
    id: w.id, code: w.code, title: w.title, description: w.description,
    type: w.type as WoType, priority: w.priority as Priority,
    source: (w.source ?? "MANUAL") as WorkOrderDTO["source"],
    frequency: (w.frequency && isFrequency(w.frequency) ? w.frequency : null) as PmFrequency | null,
    templateCode: w.template?.code ?? null,
    machineId: w.machineId, machineCode: w.machine.code, machineName: w.machine.name,
    assignedToId: w.assignedToId, assignedToName: w.assignedTo?.name ?? null,
    assignedToTrade: w.assignedTo?.trade ?? null,
    status: w.status as WoStatus, dueDate: w.dueDate.toISOString(),
    startedAt: w.startedAt?.toISOString() ?? null, completedAt: w.completedAt?.toISOString() ?? null,
    feedback: w.feedback ?? null, supervisorComment: w.supervisorComment ?? null,
    createdByName: w.createdBy?.name ?? null,
    createdAt: w.createdAt.toISOString(),
    // Approval loop — artisan sees this until the Engineer acknowledges
    acknowledgedAt: w.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByName: w.acknowledgedBy?.name ?? null,
    followUpCount: w.followUpCount ?? 0,
    lastNudgeAt: w.lastNudgeAt?.toISOString() ?? null,
    verification: (w.verification ?? "PENDING") as WorkOrderDTO["verification"],
    checkInMethod: (w.checkInMethod ?? null) as WorkOrderDTO["checkInMethod"],
    checkInAt: w.checkInAt?.toISOString() ?? null,
    checkInDistanceM: w.checkInDistanceM ?? null,
    checkInPhoto: w.checkInPhoto ?? null,
    flagReasons: w.flagReasons ? w.flagReasons.split("\n").filter(Boolean) : [],
    evidence,
    overrideReason: w.overrideReason ?? null,
    overrideByName: w.overrideByName ?? null,
    checkInAttempts: w._count?.checkIns ?? w.checkIns?.length ?? 0,
    steps: w.steps.map((s) => ({ id: s.id, idx: s.idx, text: s.text, opIdx: s.opIdx ?? null, opName: s.opName ?? null, doneAt: s.doneAt?.toISOString() ?? null, distanceM: s.distanceM ?? null })).sort((a, b) => a.idx - b.idx),
  };
}

export async function buildBootstrap(user: UserDTO, clientDate?: string | null, clientTz?: string | null): Promise<BootstrapData> {
  // Auto PM generation tick — internally de-duplicated per period
  await runScheduler().catch(() => null);

  const isAdmin = user.role === "ADMIN";
  // "Today" is drawn on the reporting device's wall clock (Africa/Lagos etc.)
  const { start: dayStart, end: dayEnd } = zonedDayBounds(clientDate, clientTz);
  const now = new Date();
  const d14 = new Date(now.getTime() - 14 * 86400_000);
  const d7 = new Date(now.getTime() - 7 * 86400_000);
  const d30 = new Date(now.getTime() - 30 * 86400_000);
  const d90 = new Date(now.getTime() - 90 * 86400_000);

  const machinesRaw = await db.machine.findMany({
    where: { active: true },
    include: {
      department: true, owner: true,
      components: {
        orderBy: { name: "asc" },
        include: { statusLogs: { where: { createdAt: { gte: dayStart, lte: dayEnd } }, take: 1, orderBy: { createdAt: "desc" }, include: { user: true } } },
      },
    },
    orderBy: { code: "asc" },
  });

  // Latest-known log per component (any day, not just today) — the Plant Status Register
  // must show the current standing of every valve, instrument and component even when
  // nobody logged it during this shift.
  const compIds = machinesRaw.flatMap((m) => m.components.map((c) => c.id));
  const latestPairs = compIds.length
    ? await db.statusLog.groupBy({ by: ["componentId"], _max: { createdAt: true }, where: { componentId: { in: compIds } } })
    : [];
  const latestRows = latestPairs.length
    ? await db.statusLog.findMany({
        where: { OR: latestPairs.map((p) => ({ componentId: p.componentId, createdAt: p._max.createdAt as Date })) },
        include: { user: true },
      })
    : [];
  const latestByComp = new Map(latestRows.map((l) => [l.componentId, l]));

  const machines: MachineDTO[] = machinesRaw.map((m) =>
    mapMachine({
      ...m,
      components: m.components.map((c) => {
        const latest = latestByComp.get(c.id) ?? null;
        const dto = mapComponent(c, latest);
        return { ...dto, reportedToday: c.statusLogs.length > 0, lastLog: latest ? mapLog(latest) : null };
      }),
    }, { admin: isAdmin })
  );

  const workOrdersRaw = await db.workOrder.findMany({
    where: {
      ...(isAdmin ? {} : { assignedToId: user.id }),
      OR: [
        { status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS"] } },
        { completedAt: { gte: d14 } },
        // Submitted work the Engineer has not acknowledged stays visible to its
        // artisan for 90 days, however old it gets (the follow-up loop)
        { status: "COMPLETED", acknowledgedAt: null, completedAt: { gte: d90 } },
        // Freshly acknowledged orders stay visible too — the artisan must SEE
        // the approval land to close their follow-up loop
        { acknowledgedAt: { gte: d14 } },
      ],
    },
    include: { machine: true, assignedTo: true, createdBy: true, acknowledgedBy: true, template: true, steps: { orderBy: { idx: "asc" } }, _count: { select: { checkIns: true } } },
    orderBy: { dueDate: "asc" },
  });
  const workOrders = workOrdersRaw.map(mapWo);

  const parts = await db.part.findMany({ orderBy: { code: "asc" } });

  const artisans: UserDTO[] = isAdmin
    ? (await db.user.findMany({ where: { role: "ARTISAN", active: true }, orderBy: { name: "asc" } })).map(toUserDTO)
    : [];

  // ---- PM plan templates (digitised paper WO templates) + team roster — engineer only ----
  const pmTemplates: PmTemplateDTO[] = [];
  const team: BootstrapData["team"] = [];
  if (isAdmin) {
    const templatesRaw = await db.pmTemplate.findMany({
      include: {
        machine: true,
        operations: { orderBy: { idx: "asc" } },
        workOrders: { select: { status: true } },
      },
      orderBy: [{ frequency: "asc" }, { code: "asc" }],
    });
    for (const t of templatesRaw) {
      const operations: PmOperationDTO[] = t.operations.map((op) => ({
        id: op.id, idx: op.idx, subAssembly: op.subAssembly,
        trade: op.trade as PmOperationDTO["trade"],
        tasks: op.tasks.split("\n").map((s) => s.trim()).filter(Boolean),
      }));
      pmTemplates.push({
        id: t.id, code: t.code, title: t.title,
        frequency: (isFrequency(t.frequency) ? t.frequency : "MONTHLY") as PmFrequency,
        priority: t.priority as Priority, trade: t.trade as PmTemplateDTO["trade"],
        durationMin: t.durationMin, machineId: t.machineId,
        machineCode: t.machine.code, machineName: t.machine.name,
        active: t.active, nextDueAt: t.nextDueAt.toISOString(), lastRunAt: t.lastRunAt?.toISOString() ?? null,
        operations,
        openCount: t.workOrders.filter((w) => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(w.status)).length,
      });
    }
    const teamRaw = await db.user.findMany({
      include: {
        assignedWorkOrders: { where: { status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS"] } }, select: { id: true } },
        ownedMachines: { select: { id: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    for (const u of teamRaw) {
      team.push({ ...toUserDTO(u), active: u.active, openWos: u.assignedWorkOrders.length, machines: u.ownedMachines.length });
    }
  }

  // ---- Alerts ----
  const alerts: AlertItem[] = [];
  const alertingComponents = await db.component.findMany({
    where: { currentStatus: { in: ALERTING_STATUSES }, machine: { active: true } },
    include: { machine: true, statusLogs: { take: 1, orderBy: { createdAt: "desc" }, include: { user: true } } },
  });
  for (const c of alertingComponents) {
    const meta = ALERTING_STATUSES.includes(c.currentStatus as Status);
    if (!meta) continue;
    const latest = c.statusLogs[0];
    alerts.push({
      kind: "STATUS",
      severity: CRITICAL_STATUSES.includes(c.currentStatus as Status) ? "CRITICAL" : "HIGH",
      title: `${c.machine.code} · ${c.name} · ${c.currentStatus.replace(/_/g, " ")}`,
      detail: latest?.note || `Reported by ${latest?.user.name ?? "unknown"}`,
      at: (latest?.createdAt ?? c.updatedAt).toISOString(),
      refId: c.id,
      machineId: c.machineId,
      machineCode: c.machine.code,
      status: c.currentStatus as Status,
    });
  }
  const overdueWos = workOrdersRaw.filter((w) => w.status !== "COMPLETED" && w.status !== "CANCELLED" && w.dueDate < now);
  for (const w of overdueWos) {
    alerts.push({
      kind: "OVERDUE_WO", severity: w.priority === "URGENT" ? "CRITICAL" : "HIGH",
      title: `${w.code} OVERDUE · ${w.title}`,
      detail: `${w.machine.code} · assigned ${w.assignedTo?.name ?? "nobody"} · due ${w.dueDate.toLocaleDateString("en-GB")}`,
      at: w.dueDate.toISOString(), refId: w.id, machineId: w.machineId, machineCode: w.machine.code,
    });
  }
  // Evidence flags — completed orders the system could not tie to the shop floor
  if (isAdmin) {
    for (const w of workOrdersRaw) {
      if (w.verification !== "FLAGGED") continue;
      alerts.push({
        kind: "FLAGGED_WO", severity: "HIGH",
        title: `${w.code} EVIDENCE FLAGGED · ${w.machine.code}`,
        detail: (w.flagReasons ?? "On-site check-in could not be verified").split("\n")[0],
        at: (w.completedAt ?? w.dueDate).toISOString(), refId: w.id, machineId: w.machineId, machineCode: w.machine.code,
      });
    }
  }
  const lowStock = parts.filter((p) => p.stock <= p.reorderLevel);
  for (const p of lowStock) {
    alerts.push({
      kind: "LOW_STOCK", severity: p.stock === 0 ? "HIGH" : "MEDIUM",
      title: `Low stock · ${p.code} ${p.name}`,
      detail: `${p.stock} in store (reorder at ${p.reorderLevel})`, at: now.toISOString(), refId: p.id,
    });
  }

  // Approval follow-ups — completed orders the Engineer has not acknowledged yet.
  // Artisan nudges make them urgent; anything sitting > 24h gets a standing nudge.
  // Capped to the 8 most pressing so a backlog never floods the alert panel —
  // the "To approve" KPI carries the true count.
  if (isAdmin) {
    const unacknowledged = workOrdersRaw
      .filter((w) => w.status === "COMPLETED" && !w.acknowledgedAt)
      .filter((w) => {
        const nudged = (w.lastNudgeAt?.getTime() ?? 0) > now.getTime() - 7 * 86400_000;
        const waitingHours = w.completedAt ? (now.getTime() - w.completedAt.getTime()) / 3600_000 : 0;
        return nudged || waitingHours >= 24;
      })
      .sort((a, b) => (b.lastNudgeAt?.getTime() ?? b.completedAt?.getTime() ?? 0) - (a.lastNudgeAt?.getTime() ?? a.completedAt?.getTime() ?? 0))
      .slice(0, 8);
    for (const w of unacknowledged) {
      const nudged = (w.lastNudgeAt?.getTime() ?? 0) > now.getTime() - 7 * 86400_000;
      alerts.push({
        kind: "APPROVAL",
        severity: nudged ? "HIGH" : "MEDIUM",
        title: `AWAITING APPROVAL · ${w.code} · ${w.machine.code}`,
        detail: `${w.assignedTo?.name ?? "The artisan"} submitted${w.followUpCount ? ` and followed up ${w.followUpCount}×` : ""} · waiting your acknowledgement`,
        at: (w.lastNudgeAt ?? w.completedAt ?? w.dueDate).toISOString(),
        refId: w.id, machineId: w.machineId, machineCode: w.machine.code,
      });
    }
  }

  // ---- Escalations — artisan feedback from the floor that needs the Engineer ----
  const escalationsRaw = await db.escalation.findMany({
    where: isAdmin
      ? { createdAt: { gte: d14 } } // engineer: everything raised in the last 14 days
      : { raisedById: user.id, createdAt: { gte: d14 } }, // artisan: own raised issues (loop closure)
    include: {
      machine: true, raisedBy: true, handledBy: true, reroutedTo: true,
      workOrder: { select: { code: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const escalations: EscalationDTO[] = escalationsRaw.map((e) => ({
    id: e.id, machineId: e.machineId, machineCode: e.machine.code, machineName: e.machine.name,
    componentId: e.componentId, componentName: e.componentName,
    workOrderId: e.workOrderId, workOrderCode: e.workOrder?.code ?? null,
    workOrderStatus: (e.workOrder?.status ?? null) as WoStatus | null,
    raisedById: e.raisedById, raisedByName: e.raisedBy.name,
    category: (isEscalationCategory(e.category) ? e.category : "OTHER") as EscalationCategory,
    message: e.message, photo: e.photo,
    status: e.status as EscalationDTO["status"],
    severity: e.severity as EscalationDTO["severity"],
    handledByName: e.handledBy?.name ?? null, handledAt: e.handledAt?.toISOString() ?? null,
    response: e.response, reroutedToName: e.reroutedTo?.name ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
  // OPEN escalations hit the alert feed — safety concerns go straight to the Andon strip
  for (const e of escalations) {
    if (e.status !== "OPEN") continue;
    alerts.push({
      kind: "ESCALATION",
      severity: e.severity === "CRITICAL" ? "CRITICAL" : e.severity === "HIGH" ? "HIGH" : "MEDIUM",
      title: `${ESCALATION_META[e.category].label.toUpperCase()} · ${e.machineCode}${e.componentName ? ` · ${e.componentName}` : ""}`,
      detail: `${e.raisedByName}: ${e.message}`.slice(0, 220),
      at: e.createdAt, refId: e.id, machineId: e.machineId, machineCode: e.machineCode,
    });
  }
  alerts.sort((a, b) => {
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 } as const;
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });

  // ---- Downtimes ----
  const downtimesRaw = await db.downtime.findMany({
    // Every open stoppage plant-wide: with the whole floor reporting on every
    // machine, each side must see what is down, not just what they own.
    where: { endedAt: null },
    include: { machine: true, reportedBy: true },
    orderBy: { startedAt: "desc" },
  });
  const downtimes: DowntimeDTO[] = downtimesRaw.map((d) => ({
    id: d.id, machineId: d.machineId, machineCode: d.machine.code, machineName: d.machine.name,
    reason: d.reason, startedAt: d.startedAt.toISOString(), endedAt: d.endedAt?.toISOString() ?? null,
    reportedByName: d.reportedBy.name,
  }));

  // ---- Not reported today (admin: all machines; artisan: own) ----
  const notReportedToday: BootstrapData["notReportedToday"] = [];
  for (const m of machines) {
    const missing = m.components.filter((c) => !c.reportedToday);
    if (missing.length > 0 && m.components.length > 0) {
      notReportedToday.push({
        machineId: m.id, machineCode: m.code, machineName: m.name,
        components: missing.map((c) => c.name),
      });
    }
  }

  // ---- Recent activity ----
  const activityRaw = await db.statusLog.findMany({
    where: isAdmin ? {} : { user: { id: user.id } },
    include: { user: true, component: { include: { machine: true } } },
    orderBy: { createdAt: "desc" }, take: 25,
  });
  const recentActivity = activityRaw.map((l) => ({
    ...mapLog(l),
    componentName: l.component.name,
    machineCode: l.component.machine.code,
  }));

  // ---- Stats ----
  const allComps = machines.flatMap((m) => m.components);
  const reportedToday = allComps.filter((c) => c.reportedToday).length;
  const totalComponents = allComps.length;
  const completed7d = await db.workOrder.findMany({
    where: { status: "COMPLETED", completedAt: { gte: d7 }, ...(isAdmin ? {} : { assignedToId: user.id }) },
    select: { createdAt: true, completedAt: true },
  });
  const created7d = await db.workOrder.count({
    where: { createdAt: { gte: d7 }, ...(isAdmin ? {} : { assignedToId: user.id }) },
  });
  const completionRate7d = created7d > 0 ? Math.round((completed7d.length / created7d) * 100) : completed7d.length > 0 ? 100 : 0;
  const durations = completed7d
    .filter((w) => w.completedAt)
    .map((w) => (w.completedAt!.getTime() - w.createdAt.getTime()) / 3600_000);
  const avgCompletionHours = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;

  // Evidence-chain KPIs — of the orders completed in the last 7 days, how many carry on-site proof
  const completed7dFull = await db.workOrder.findMany({
    where: { status: "COMPLETED", completedAt: { gte: d7 }, ...(isAdmin ? {} : { assignedToId: user.id }) },
    select: { verification: true },
  });
  const verified7d = completed7dFull.filter((w) => w.verification === "VERIFIED" || w.verification === "OVERRIDE").length;
  const verifiedRate7d = completed7dFull.length ? Math.round((verified7d / completed7dFull.length) * 100) : null;
  const flaggedCount = isAdmin
    ? workOrdersRaw.filter((w) => w.verification === "FLAGGED").length
    : 0;

  // Closure rate — of the orders completed in the last 30 days, how many the
  // Engineer has acknowledged. The artisan follows this to chase approvals.
  const completed30d = await db.workOrder.findMany({
    where: { status: "COMPLETED", completedAt: { gte: d30 }, ...(isAdmin ? {} : { assignedToId: user.id }) },
    select: { acknowledgedAt: true },
  });
  const closureRate = completed30d.length
    ? Math.round((completed30d.filter((w) => w.acknowledgedAt).length / completed30d.length) * 100)
    : null;

  const stats: StatsDTO = {
    openWorkOrders: workOrdersRaw.filter((w) => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(w.status)).length,
    overdueWorkOrders: overdueWos.length,
    completionRate7d,
    downComponents: allComps.filter((c) => c.currentStatus === "BROKEN").length,
    reportedToday, totalComponents,
    avgCompletionHours, lowStockCount: lowStock.length,
    verifiedRate7d, flaggedCount,
    closureRate,
    pendingApprovalCount: workOrdersRaw.filter((w) => w.status === "COMPLETED" && !w.acknowledgedAt).length,
  };

  const org = await readOrg();

  // Maintenance mode — flipped from the owner's dev console. Artisans see a
  // lockout screen while it is ON; engineers keep full access.
  const maintenanceRow = await db.settings.findUnique({ where: { key: "maintenanceMode" } });
  const maintenance = maintenanceRow?.value === "on";

  return { user, machines, workOrders, parts, artisans, alerts, stats, downtimes, notReportedToday, recentActivity, pmTemplates, team, escalations, org, maintenance };
}

export { mapLog, mapComponent, mapMachine, mapWo };

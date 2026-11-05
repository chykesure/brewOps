import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { ensureChecklistSeed } from "@/lib/checklist-seed";
import type { Prisma, ChecklistEntry, ChecklistRun } from "@prisma/client";
import {
  isChecklistRowStatus,
  type ChecklistAdminData, type ChecklistArtisanData,
  type ChecklistComplianceCell, type ChecklistCellState,
  type ChecklistCounts, type ChecklistRankRow, type ChecklistRunDTO,
  type ChecklistTemplateDTO, type RecheckItem, type ChecklistRowDTO,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86400_000;

type EntryWithRow = ChecklistEntry & { row: { idx: number } };
type RunFull = ChecklistRun & {
  artisan: { id: string; name: string; trade: string | null; shift: string | null };
  template: { id: string; title: string };
  ackBy: { name: string } | null;
  entries: EntryWithRow[];
};

const RUN_INCLUDE = {
  artisan: { select: { id: true, name: true, trade: true, shift: true } },
  template: { select: { id: true, title: true } },
  ackBy: { select: { name: true } },
  entries: { include: { row: { select: { idx: true } } } },
} satisfies Prisma.ChecklistRunInclude;

function countsFrom(entries: { status: string }[]): ChecklistCounts {
  const c: ChecklistCounts = { done: 0, fault: 0, skipped: 0, recheck: 0, pending: 0, total: entries.length };
  for (const e of entries) {
    if (e.status === "DONE") c.done++;
    else if (e.status === "FAULT") c.fault++;
    else if (e.status === "SKIPPED") c.skipped++;
    else if (e.status === "RECHECK") c.recheck++;
    else c.pending++;
  }
  return c;
}

function mapRun(r: RunFull, opts?: { withEntries?: boolean }): ChecklistRunDTO {
  const sorted = r.entries.slice().sort((a, b) => a.row.idx - b.row.idx || a.id.localeCompare(b.id));
  return {
    id: r.id,
    templateId: r.templateId,
    templateTitle: r.template.title,
    weekStart: r.weekStart.toISOString(),
    status: r.status as ChecklistRunDTO["status"],
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    totalPlannedMin: r.totalPlannedMin,
    totalActualMin: r.totalActualMin,
    artisanId: r.artisan.id,
    artisanName: r.artisan.name,
    trade: r.artisan.trade,
    shift: r.artisan.shift,
    ackByName: r.ackBy?.name ?? null,
    ackAt: r.ackAt?.toISOString() ?? null,
    ackNote: r.ackNote,
    counts: countsFrom(r.entries),
    entries: opts?.withEntries === false ? [] : sorted.map((e) => ({
      id: e.id,
      rowId: e.rowId,
      machineName: e.machineName,
      task: e.task,
      plannedMin: e.plannedMin,
      status: e.status as ChecklistRunDTO["entries"][number]["status"],
      note: e.note,
      photo: e.photo,
      doneAt: e.doneAt?.toISOString() ?? null,
      escalationId: e.escalationId,
      recheckResolvedAt: e.recheckResolvedAt?.toISOString() ?? null,
    })),
  };
}

function mapTemplate(t: {
  id: string; title: string; trade: string; active: boolean;
  rows: { id: string; idx: number; machineName: string; machineId: string | null; task: string; plannedMin: number; active: boolean }[];
}): ChecklistTemplateDTO {
  const rows: ChecklistRowDTO[] = t.rows
    .slice()
    .sort((a, b) => a.idx - b.idx || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id, idx: r.idx, machineName: r.machineName, machineId: r.machineId,
      task: r.task, plannedMin: r.plannedMin, active: r.active,
    }));
  return {
    id: t.id, title: t.title, trade: t.trade, active: t.active,
    totalPlannedMin: rows.filter((r) => r.active).reduce((s, r) => s + r.plannedMin, 0),
    rows,
  };
}

function parseWeek(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Monday 00:00 of the week containing `d` — server fallback only (the client
// always sends its own device-local Monday, which is the stored week key).
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const day = (x.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

// GET /api/checklists/runs
//   ?week=<ISO>                → artisan: this week's sheets, my runs, my history
//   ?view=admin&week=<ISO>&days=30 → Engineer: compliance grid, ranking, re-checks
//   ?run=<id>                  → one full run (owner or Engineer)
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    await ensureChecklistSeed();
    const sp = req.nextUrl.searchParams;

    // ---- Single run detail (owner or Engineer) ----
    const runId = sp.get("run");
    if (runId) {
      const run = await db.checklistRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
      if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
      if (user.role !== "ADMIN" && run.artisanId !== user.id) {
        return NextResponse.json({ error: "Not your checklist sheet." }, { status: 403 });
      }
      return NextResponse.json({ run: mapRun(run as RunFull) });
    }

    // ---- Engineer dashboard ----
    if (sp.get("view") === "admin") {
      if (user.role !== "ADMIN") return NextResponse.json({ error: "Engineer access only." }, { status: 403 });
      const week = parseWeek(sp.get("week")) ?? mondayOf(new Date());
      const days = Math.max(7, Math.min(180, Math.round(Number(sp.get("days")) || 30)));

      const weekStarts: Date[] = [];
      for (let i = 0; i < 6; i++) weekStarts.push(new Date(week.getTime() - i * WEEK_MS));

      const [templatesRaw, runsRaw, recheckRaw, rankRunsRaw] = await Promise.all([
        db.checklistTemplate.findMany({ include: { rows: { orderBy: { idx: "asc" } } }, orderBy: [{ active: "desc" }, { trade: "asc" }] }),
        db.checklistRun.findMany({
          where: { weekStart: { in: weekStarts } },
          include: RUN_INCLUDE,
          orderBy: { weekStart: "desc" },
        }),
        db.checklistEntry.findMany({
          where: { status: "RECHECK", recheckResolvedAt: null, run: { status: { in: ["SUBMITTED", "ACKNOWLEDGED"] } } },
          include: { run: { include: { artisan: { select: { name: true } }, template: { select: { title: true, trade: true } } } } },
          orderBy: { doneAt: "desc" },
          take: 40,
        }),
        // Ranking window is independent of the 6-week grid — the board must be
        // truthful even when the Engineer picks a 91-day lens.
        db.checklistRun.findMany({
          where: {
            status: { in: ["SUBMITTED", "ACKNOWLEDGED"] },
            OR: [{ completedAt: { gte: new Date(Date.now() - days * 86400_000) } }, { weekStart: { gte: new Date(Date.now() - days * 86400_000) } }],
          },
          include: RUN_INCLUDE,
          orderBy: { weekStart: "desc" },
        }),
      ]);

      // Compliance grid — green done · amber late/incomplete · red missing · open in progress
      const weeks = weekStarts.map((ws) => {
        const wsTime = ws.getTime();
        const weekEnd = wsTime + WEEK_MS;
        const cells: ChecklistComplianceCell[] = templatesRaw.map((t) => {
          const runs = runsRaw.filter((r) => r.templateId === t.id && r.weekStart.getTime() === wsTime);
          const submitted = runs.filter((r) => r.status !== "IN_PROGRESS");
          let state: ChecklistCellState;
          if (!t.active) state = "NONE";
          else if (submitted.length === 0) {
            state = runs.length > 0 && wsTime === week.getTime() ? "OPEN" : "RED";
          } else {
            const late = submitted.some((r) => r.completedAt && r.completedAt.getTime() >= weekEnd);
            const pendingSum = submitted.reduce((s, r) => s + countsFrom(r.entries).pending, 0);
            state = late || pendingSum > 0 ? "AMBER" : "GREEN";
          }
          return {
            templateId: t.id,
            state,
            runCount: submitted.length,
            artisanNames: submitted.map((r) => r.artisan.name),
            late: submitted.some((r) => r.completedAt && r.completedAt.getTime() >= weekEnd),
          };
        });
        return { weekStart: ws.toISOString(), cells };
      });

      // Efficiency ranking — completed sheets in the window, ranked by
      // completion % first, then by pace (actual vs planned minutes).
      const byArtisan = new Map<string, { run: RunFull[]; name: string; trade: string | null; shift: string | null }>();
      for (const r of rankRunsRaw) {
        const bucket = byArtisan.get(r.artisanId) ?? { run: [], name: r.artisan.name, trade: r.artisan.trade, shift: r.artisan.shift };
        bucket.run.push(r as RunFull);
        byArtisan.set(r.artisanId, bucket);
      }
      const ranking: ChecklistRankRow[] = [];
      for (const [artisanId, b] of byArtisan) {
        const allEntries = b.run.flatMap((r) => r.entries);
        const tasksTotal = allEntries.length;
        const tasksDone = allEntries.filter((e) => e.status === "DONE").length;
        const planned = b.run.map((r) => r.totalPlannedMin).filter((n) => n > 0);
        const actual = b.run.map((r) => r.totalActualMin).filter((n): n is number => typeof n === "number" && n >= 0);
        const avgPlanned = planned.length ? planned.reduce((a, c) => a + c, 0) / planned.length : null;
        const avgActual = actual.length ? actual.reduce((a, c) => a + c, 0) / actual.length : null;
        ranking.push({
          artisanId,
          name: b.name,
          trade: b.trade,
          shift: b.shift,
          runs: b.run.length,
          tasksDone,
          tasksTotal,
          completionPct: tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0,
          avgPlannedMin: avgPlanned !== null ? Math.round(avgPlanned) : null,
          avgActualMin: avgActual !== null ? Math.round(avgActual * 10) / 10 : null,
          pacePct: avgPlanned && avgActual !== null ? Math.round((avgActual / avgPlanned) * 100) : null,
          faults: allEntries.filter((e) => e.status === "FAULT").length,
          rechecks: allEntries.filter((e) => e.status === "RECHECK").length,
        });
      }
      ranking.sort((a, b) => b.completionPct - a.completionPct || (a.pacePct ?? 999) - (b.pacePct ?? 999) || b.tasksDone - a.tasksDone);

      const recheckQueue: RecheckItem[] = recheckRaw.map((e) => ({
        entryId: e.id,
        runId: e.runId,
        weekStart: e.run.weekStart.toISOString(),
        templateTitle: e.run.template.title,
        trade: e.run.template.trade,
        artisanName: e.run.artisan.name,
        machineName: e.machineName,
        task: e.task,
        note: e.note,
        flaggedAt: e.doneAt?.toISOString() ?? null,
      }));

      const recentRunsRaw = await db.checklistRun.findMany({
        where: { status: { in: ["SUBMITTED", "ACKNOWLEDGED"] } },
        include: RUN_INCLUDE,
        orderBy: [{ completedAt: "desc" }],
        take: 12,
      });
      const recentRuns = recentRunsRaw.map((r) => mapRun(r as RunFull, { withEntries: false }));

      const data: ChecklistAdminData = {
        weekStart: week.toISOString(),
        days,
        weeks,
        templates: templatesRaw.map(mapTemplate),
        ranking,
        recheckQueue,
        recentRuns,
      };
      return NextResponse.json(data);
    }

    // ---- Artisan (own) view ----
    const week = parseWeek(sp.get("week")) ?? mondayOf(new Date());
    const tradeFilter = user.role === "ARTISAN" && user.trade ? { trade: user.trade } : {};
    const templatesRaw = await db.checklistTemplate.findMany({
      where: { active: true, ...tradeFilter },
      include: { rows: { where: { active: true }, orderBy: { idx: "asc" } } },
      orderBy: [{ trade: "asc" }, { title: "asc" }],
    });

    const [weekRuns, historyRaw] = await Promise.all([
      db.checklistRun.findMany({
        where: { artisanId: user.id, weekStart: week },
        include: RUN_INCLUDE,
      }),
      db.checklistRun.findMany({
        where: { artisanId: user.id, weekStart: { lt: week } },
        include: RUN_INCLUDE,
        orderBy: [{ weekStart: "desc" }, { startedAt: "desc" }],
        take: 8,
      }),
    ]);

    const data: ChecklistArtisanData = {
      weekStart: week.toISOString(),
      templates: templatesRaw.map(mapTemplate),
      runs: weekRuns.map((r) => mapRun(r as RunFull)),
      history: historyRaw.map((r) => mapRun(r as RunFull)),
    };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not load the checklist data." }, { status: 500 });
  }
}

// POST /api/checklists/runs — one endpoint, five audited actions:
//   start {templateId, weekStart} · tick {runId, entryId, status, note?, photo?}
//   submit {runId} · ack {runId, note?} (Engineer) · resolveRecheck {entryId} (Engineer)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    await ensureChecklistSeed();
    const body = await req.json();
    const action = String(body?.action ?? "");

    // ---- START: open this week's sheet (auto-timer begins) ----
    if (action === "start") {
      const templateId = String(body?.templateId ?? "");
      const week = parseWeek(body?.weekStart ? String(body.weekStart) : null);
      if (!week) return NextResponse.json({ error: "Invalid week." }, { status: 400 });
      const template = await db.checklistTemplate.findUnique({
        where: { id: templateId },
        include: { rows: { where: { active: true }, orderBy: { idx: "asc" } } },
      });
      if (!template || !template.active) return NextResponse.json({ error: "Checklist template not found or retired." }, { status: 404 });
      if (user.role !== "ADMIN" && user.trade && template.trade !== user.trade) {
        return NextResponse.json({ error: `This sheet belongs to the ${template.trade === "ELECTRICAL" ? "Electrical" : "Mechanical"} team.` }, { status: 403 });
      }
      if (template.rows.length === 0) return NextResponse.json({ error: "This sheet has no task rows yet — ask the Engineer to add them." }, { status: 400 });

      const existing = await db.checklistRun.findUnique({
        where: { templateId_weekStart_artisanId: { templateId, weekStart: week, artisanId: user.id } },
        include: RUN_INCLUDE,
      });
      if (existing) {
        if (existing.status !== "IN_PROGRESS") {
          return NextResponse.json({ error: "You already submitted this week's sheet.", runId: existing.id }, { status: 409 });
        }
        return NextResponse.json({ ok: true, run: mapRun(existing as RunFull) }); // resume
      }

      const created = await db.checklistRun.create({
        data: {
          templateId,
          weekStart: week,
          artisanId: user.id,
          shift: user.shift,
          status: "IN_PROGRESS",
          startedAt: new Date(),
          entries: {
            create: template.rows.map((row) => ({
              rowId: row.id,
              machineName: row.machineName,
              task: row.task,
              plannedMin: row.plannedMin,
            })),
          },
        },
        include: RUN_INCLUDE,
      });
      return NextResponse.json({ ok: true, run: mapRun(created as RunFull) });
    }

    // ---- Everything below needs the run ----
    const runId = String(body?.runId ?? "");

    if (action === "tick") {
      const entryId = String(body?.entryId ?? "");
      const status = String(body?.status ?? "");
      if (!isChecklistRowStatus(status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
      const note = body?.note !== undefined ? String(body.note).trim().slice(0, 500) : undefined;
      const photo = body?.photo !== undefined ? (body.photo ? String(body.photo).slice(0, 300) : null) : undefined;

      const run = await db.checklistRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
      if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
      if (run.artisanId !== user.id) return NextResponse.json({ error: "Not your checklist sheet." }, { status: 403 });
      if (run.status !== "IN_PROGRESS") return NextResponse.json({ error: "This sheet was already submitted." }, { status: 409 });

      const entry = run.entries.find((e) => e.id === entryId);
      if (!entry) return NextResponse.json({ error: "Task row not found on this sheet." }, { status: 404 });
      if (status === "FAULT" && !(note !== undefined ? note : (entry.note ?? ""))) {
        return NextResponse.json({ error: "Describe the fault — the Engineer needs detail to act." }, { status: 400 });
      }

      // FAULT on a machine-linked row raises an escalation into the Engineer's loop
      let escalationId = entry.escalationId;
      if (status === "FAULT" && !escalationId) {
        const row = await db.checklistRow.findUnique({ where: { id: entry.rowId }, select: { machineId: true } });
        if (row?.machineId) {
          const esc = await db.escalation.create({
            data: {
              machineId: row.machineId,
              raisedById: user.id,
              category: "OTHER",
              message: `[Weekly Checklist · ${entry.machineName}] ${entry.task} — ${note !== undefined ? note : (entry.note ?? "Fault found during the weekly checklist")}`,
              severity: "NORMAL",
              status: "OPEN",
            },
          });
          escalationId = esc.id;
        }
      }

      const updated = await db.checklistEntry.update({
        where: { id: entryId },
        data: {
          status,
          doneAt: status === "PENDING" ? null : new Date(),
          ...(note !== undefined ? { note: note || null } : {}),
          ...(photo !== undefined ? { photo } : {}),
          ...(escalationId ? { escalationId } : {}),
        },
      });
      return NextResponse.json({ ok: true, status: updated.status, escalationId: updated.escalationId });
    }

    if (action === "submit") {
      const run = await db.checklistRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
      if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
      if (run.artisanId !== user.id) return NextResponse.json({ error: "Not your checklist sheet." }, { status: 403 });
      if (run.status !== "IN_PROGRESS") return NextResponse.json({ error: "This sheet was already submitted." }, { status: 409 });

      const now = new Date();
      const totalPlannedMin = run.entries.reduce((s, e) => s + e.plannedMin, 0);
      const actualMin = Math.max(0, (now.getTime() - run.startedAt.getTime()) / 60000);
      const updated = await db.checklistRun.update({
        where: { id: runId },
        data: {
          status: "SUBMITTED",
          completedAt: now,
          totalPlannedMin,
          totalActualMin: Math.round(actualMin * 10) / 10,
        },
        include: RUN_INCLUDE,
      });
      return NextResponse.json({ ok: true, run: mapRun(updated as RunFull) });
    }

    if (action === "ack") {
      if (user.role !== "ADMIN") return NextResponse.json({ error: "Engineer access only." }, { status: 403 });
      const run = await db.checklistRun.findUnique({ where: { id: runId } });
      if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
      if (run.status !== "SUBMITTED") return NextResponse.json({ error: "Only submitted sheets can be acknowledged." }, { status: 409 });
      const note = body?.note !== undefined ? String(body.note).trim().slice(0, 500) : null;
      await db.checklistRun.update({
        where: { id: runId },
        data: { status: "ACKNOWLEDGED", ackById: user.id, ackAt: new Date(), ackNote: note || null },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "resolveRecheck") {
      if (user.role !== "ADMIN") return NextResponse.json({ error: "Engineer access only." }, { status: 403 });
      const entryId = String(body?.entryId ?? "");
      const entry = await db.checklistEntry.findUnique({ where: { id: entryId } });
      if (!entry) return NextResponse.json({ error: "Task row not found." }, { status: 404 });
      if (entry.status !== "RECHECK") return NextResponse.json({ error: "This row is not flagged for re-check." }, { status: 409 });
      await db.checklistEntry.update({
        where: { id: entryId },
        data: { recheckResolvedAt: new Date(), recheckResolvedById: user.id },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Checklist action failed." }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { ensureChecklistSeed } from "@/lib/checklist-seed";
import type { ChecklistRowDTO, ChecklistTemplateDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  const totalPlannedMin = rows.filter((r) => r.active).reduce((sum, r) => sum + r.plannedMin, 0);
  return { id: t.id, title: t.title, trade: t.trade, active: t.active, totalPlannedMin, rows };
}

// GET /api/checklists/templates — the sheet templates with their rows.
// Artisans receive active templates (active rows); the Engineer also sees
// inactive ones for editing. Seeds the two scanned paper sheets on first call.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    await ensureChecklistSeed();
    const isAdmin = user.role === "ADMIN";
    const templatesRaw = await db.checklistTemplate.findMany({
      where: isAdmin ? {} : { active: true },
      include: { rows: isAdmin ? { orderBy: { idx: "asc" } } : { where: { active: true }, orderBy: { idx: "asc" } } },
      orderBy: [{ active: "desc" }, { trade: "asc" }, { title: "asc" }],
    });
    return NextResponse.json({ templates: templatesRaw.map(mapTemplate) });
  } catch {
    return NextResponse.json({ error: "Could not load checklist templates." }, { status: 500 });
  }
}

// POST /api/checklists/templates — Engineer adds a new (empty) sheet template.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Engineer access only." }, { status: 403 });

  try {
    const body = await req.json();
    const title = String(body?.title ?? "").trim().slice(0, 120);
    const trade = String(body?.trade ?? "MECHANICAL") === "ELECTRICAL" ? "ELECTRICAL" : "MECHANICAL";
    if (title.length < 4) return NextResponse.json({ error: "Give the sheet a clear title." }, { status: 400 });
    const created = await db.checklistTemplate.create({ data: { title, trade } });
    return NextResponse.json({ ok: true, id: created.id });
  } catch {
    return NextResponse.json({ error: "Could not create the template." }, { status: 500 });
  }
}

// PATCH /api/checklists/templates — Engineer edits a template and syncs its rows.
// Rows are never hard-deleted (run history keeps its snapshots): rows missing
// from the payload are retired (active = false), so they vanish from new runs
// but every past tick stays intact.
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Engineer access only." }, { status: 403 });

  try {
    const body = await req.json();
    const templateId = String(body?.templateId ?? "");
    const template = await db.checklistTemplate.findUnique({ where: { id: templateId } });
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });

    const title = body?.title !== undefined ? String(body.title).trim().slice(0, 120) : undefined;
    const active = body?.active !== undefined ? Boolean(body.active) : undefined;
    if (title !== undefined && title.length < 4) {
      return NextResponse.json({ error: "Give the sheet a clear title." }, { status: 400 });
    }
    await db.checklistTemplate.update({
      where: { id: templateId },
      data: { ...(title !== undefined ? { title } : {}), ...(active !== undefined ? { active } : {}) },
    });

    // ---- Row sync (whole-list edit from the template editor) ----
    if (Array.isArray(body?.rows)) {
      const incoming = (body.rows as Record<string, unknown>[]).map((r, i) => ({
        id: r.id ? String(r.id) : null,
        machineName: String(r.machineName ?? "").trim().slice(0, 80),
        task: String(r.task ?? "").trim().slice(0, 400),
        plannedMin: Math.max(1, Math.min(600, Math.round(Number(r.plannedMin) || 10))),
        active: r.active === false ? false : true,
        machineId: r.machineId ? String(r.machineId) : null,
        idx: (i + 1) * 10,
      }));
      for (const r of incoming) {
        if (!r.machineName || !r.task) {
          return NextResponse.json({ error: "Every row needs an equipment name and a task." }, { status: 400 });
        }
        if (r.machineId) {
          const machine = await db.machine.findUnique({ where: { id: r.machineId } });
          if (!machine) return NextResponse.json({ error: "Linked machine not found." }, { status: 400 });
        }
      }

      const existing = await db.checklistRow.findMany({ where: { templateId }, select: { id: true } });
      const incomingIds = new Set(incoming.filter((r) => r.id).map((r) => r.id as string));
      const retire = existing.filter((r) => !incomingIds.has(r.id)).map((r) => r.id);
      if (retire.length) {
        await db.checklistRow.updateMany({ where: { id: { in: retire } }, data: { active: false } });
      }
      for (const r of incoming) {
        if (r.id) {
          await db.checklistRow.update({
            where: { id: r.id },
            data: {
              idx: r.idx, machineName: r.machineName, task: r.task,
              plannedMin: r.plannedMin, active: r.active, machineId: r.machineId,
            },
          });
        } else {
          await db.checklistRow.create({
            data: {
              templateId, idx: r.idx, machineName: r.machineName, task: r.task,
              plannedMin: r.plannedMin, active: r.active, machineId: r.machineId,
            },
          });
        }
      }
    }

    const updated = await db.checklistTemplate.findUnique({
      where: { id: templateId },
      include: { rows: { orderBy: { idx: "asc" } } },
    });
    return NextResponse.json({ ok: true, template: updated ? mapTemplate(updated) : null });
  } catch {
    return NextResponse.json({ error: "Could not save the template." }, { status: 500 });
  }
}
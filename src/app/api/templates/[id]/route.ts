import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isFrequency, isPriority, isTrade } from "@/lib/types";

interface OpInput { subAssembly?: unknown; trade?: unknown; tasks?: unknown }

// PATCH /api/templates/[id] — edit plan fields, replace operations, activate/deactivate
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await ctx.params;

  try {
    const body = await req.json();
    const template = await db.pmTemplate.findUnique({ where: { id } });
    if (!template) return NextResponse.json({ error: "PM plan not found." }, { status: 404 });

    const data: Record<string, unknown> = {};

    if (body.title !== undefined) data.title = String(body.title).slice(0, 140);
    if (body.frequency !== undefined && isFrequency(String(body.frequency))) data.frequency = String(body.frequency);
    if (body.priority !== undefined && isPriority(String(body.priority))) data.priority = String(body.priority);
    if (body.trade !== undefined && isTrade(String(body.trade))) data.trade = String(body.trade);
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.durationMin !== undefined) data.durationMin = body.durationMin ? Math.max(5, Math.min(1440, Number(body.durationMin) || 0)) : null;
    if (body.machineId !== undefined) {
      const machine = await db.machine.findUnique({ where: { id: String(body.machineId) } });
      if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
      data.machineId = machine.id;
    }
    if (body.nextDueAt !== undefined) {
      const due = new Date(String(body.nextDueAt));
      if (isNaN(due.getTime())) return NextResponse.json({ error: "Invalid next due date." }, { status: 400 });
      data.nextDueAt = due;
    }

    // Replace the whole operation set when provided (simplest correct semantics)
    if (Array.isArray(body.operations)) {
      const ops = (body.operations as OpInput[])
        .map((o, i) => ({
          idx: (i + 1) * 10,
          subAssembly: String(o.subAssembly ?? "").trim() || `Operation ${(i + 1) * 10}`,
          trade: isTrade(String(o.trade)) ? String(o.trade) : "MECHANICAL",
          tasks: Array.isArray(o.tasks)
            ? o.tasks.map((s: unknown) => String(s).trim()).filter(Boolean).join("\n")
            : String(o.tasks ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join("\n"),
        }))
        .filter((o) => o.tasks.length > 0 || o.subAssembly);
      if (ops.length === 0) return NextResponse.json({ error: "At least one operation with tasks is required." }, { status: 400 });
      data.operations = { deleteMany: { templateId: id }, create: ops.map(({ idx, subAssembly, trade, tasks }) => ({ idx, subAssembly, trade, tasks })) };
    }

    await db.pmTemplate.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update PM plan." }, { status: 500 });
  }
}

// DELETE /api/templates/[id] — remove a plan (generated work orders are kept for the audit trail)
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await ctx.params;

  try {
    const template = await db.pmTemplate.findUnique({ where: { id }, include: { workOrders: { take: 1 } } });
    if (!template) return NextResponse.json({ error: "PM plan not found." }, { status: 404 });
    // Keep historical integrity: if orders were generated, deactivate instead of deleting
    if (template.workOrders.length > 0) {
      await db.pmTemplate.update({ where: { id }, data: { active: false } });
      return NextResponse.json({ ok: true, deactivated: true });
    }
    await db.pmTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete PM plan." }, { status: 500 });
  }
}

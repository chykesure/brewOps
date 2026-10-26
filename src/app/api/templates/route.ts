import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isFrequency, isPriority, isTrade } from "@/lib/types";

// GET /api/templates — list PM plan templates with generated order counts (admin)
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const templates = await db.pmTemplate.findMany({
    include: {
      machine: true,
      operations: { orderBy: { idx: "asc" } },
      workOrders: { select: { status: true } },
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id, code: t.code, title: t.title, frequency: t.frequency, priority: t.priority,
      trade: t.trade, durationMin: t.durationMin, machineId: t.machineId,
      machineCode: t.machine.code, machineName: t.machine.name,
      active: t.active, nextDueAt: t.nextDueAt, lastRunAt: t.lastRunAt,
      openCount: t.workOrders.filter((w) => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(w.status)).length,
      operations: t.operations.map((op) => ({
        id: op.id, idx: op.idx, subAssembly: op.subAssembly, trade: op.trade,
        tasks: op.tasks.split("\n").map((s) => s.trim()).filter(Boolean),
      })),
    })),
  });
}

interface OpInput { subAssembly?: unknown; trade?: unknown; tasks?: unknown }

// POST /api/templates — create a PM plan (admin)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const body = await req.json();
    const { code, title, frequency, priority, trade, machineId, durationMin, nextDueAt, operations } = body ?? {};
    if (!title || !machineId) {
      return NextResponse.json({ error: "Title and machine are required." }, { status: 400 });
    }
    const machine = await db.machine.findUnique({ where: { id: String(machineId) } });
    if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });

    const freq = isFrequency(String(frequency)) ? String(frequency) : "MONTHLY";
    const prio = isPriority(String(priority)) ? String(priority) : "NORMAL";
    const tr = isTrade(String(trade)) ? String(trade) : "MECHANICAL";

    // Plan code: auto "MP-xxx" from Seq if not supplied
    let planCode = code ? String(code).trim().toUpperCase() : "";
    if (planCode && await db.pmTemplate.findUnique({ where: { code: planCode } })) {
      return NextResponse.json({ error: `Plan code ${planCode} already exists.` }, { status: 400 });
    }
    if (!planCode) {
      const seq = await db.seq.upsert({ where: { key: "MP" }, create: { key: "MP", value: 880 }, update: { value: { increment: 1 } } });
      planCode = `MP-${seq.value}`;
    }

    const opInput: OpInput[] = Array.isArray(operations) ? operations : [];
    const ops = opInput
      .map((o, i) => ({
        idx: (i + 1) * 10,
        subAssembly: String(o.subAssembly ?? "").trim() || `Operation ${(i + 1) * 10}`,
        trade: isTrade(String(o.trade)) ? String(o.trade) : tr,
        tasks: Array.isArray(o.tasks)
          ? o.tasks.map((s: unknown) => String(s).trim()).filter(Boolean).join("\n")
          : String(o.tasks ?? "").split("\n").map((s) => s.trim()).filter(Boolean).join("\n"),
      }))
      .filter((o) => o.tasks.length > 0 || o.subAssembly);

    if (ops.length === 0) return NextResponse.json({ error: "At least one operation with tasks is required." }, { status: 400 });

    let due = nextDueAt ? new Date(String(nextDueAt)) : new Date();
    if (isNaN(due.getTime())) due = new Date();

    const template = await db.pmTemplate.create({
      data: {
        code: planCode,
        title: String(title).slice(0, 140),
        frequency: freq,
        priority: prio,
        trade: tr,
        durationMin: durationMin ? Math.max(5, Math.min(1440, Number(durationMin) || 0)) : null,
        machineId: machine.id,
        nextDueAt: due,
        operations: { create: ops.map(({ idx, subAssembly, trade: t2, tasks }) => ({ idx, subAssembly, trade: t2, tasks })) },
      },
    });

    return NextResponse.json({ ok: true, id: template.id, code: template.code });
  } catch (e) {
    console.error("[templates.POST] failed:", e);
    return NextResponse.json({ error: "Could not create PM plan." }, { status: 500 });
  }
}

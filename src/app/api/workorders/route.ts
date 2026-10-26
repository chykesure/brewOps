import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isPriority, isWoType } from "@/lib/types";

const PM_STEPS = [
  "Visual inspection: leaks, unusual noise, vibration",
  "Check & record operating parameters",
  "Check lubrication level & condition",
  "Inspect seals, couplings & fasteners",
  "Verify guards & safety devices in place",
  "Test run & confirm normal operation",
];
const CORRECTIVE_STEPS = ["Diagnose fault & isolate safely", "Repair / replace component", "Test run & verify fix", "Report findings in notes"];

// POST /api/workorders — create a work order (admin)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const body = await req.json();
    const { machineId, title, type, priority, assignedToId, dueDate, steps, description } = body ?? {};
    if (!machineId || !title || !dueDate) {
      return NextResponse.json({ error: "machineId, title and dueDate are required." }, { status: 400 });
    }
    const machine = await db.machine.findUnique({ where: { id: machineId } });
    if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });

    const woType = isWoType(String(type)) ? String(type) : "PM";
    const prio = isPriority(String(priority)) ? String(priority) : "NORMAL";
    let stepList: string[] = Array.isArray(steps) && steps.length > 0
      ? steps.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 20)
      : woType === "PM" ? PM_STEPS : CORRECTIVE_STEPS;

    const seq = await db.seq.upsert({ where: { key: "WO" }, create: { key: "WO", value: 1001 }, update: { value: { increment: 1 } } });
    const due = new Date(String(dueDate));
    if (isNaN(due.getTime())) return NextResponse.json({ error: "Invalid dueDate." }, { status: 400 });

    const wo = await db.workOrder.create({
      data: {
        code: `WO-${seq.value}`,
        title: String(title).slice(0, 140),
        description: description ? String(description).slice(0, 800) : null,
        type: woType,
        priority: prio,
        machineId: machine.id,
        assignedToId: assignedToId ? String(assignedToId) : null,
        createdById: user.id,
        status: "PENDING",
        dueDate: due,
        steps: { create: stepList.map((text, i) => ({ idx: i + 1, text })) },
      },
      include: { machine: true, assignedTo: true, steps: true },
    });

    return NextResponse.json({ ok: true, id: wo.id, code: wo.code });
  } catch {
    return NextResponse.json({ error: "Could not create work order." }, { status: 500 });
  }
}

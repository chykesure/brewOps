import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isEscalationCategory } from "@/lib/types";

// POST /api/escalations — an Artisan (or the Engineer) raises an issue from the floor.
// The escalation lands on the Engineer Command Center with Quick-fix / Reroute actions.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const machineId = String(body?.machineId ?? "");
    if (!machineId) return NextResponse.json({ error: "machineId is required." }, { status: 400 });

    const machine = await db.machine.findUnique({ where: { id: machineId } });
    if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });

    const category = isEscalationCategory(String(body?.category ?? "")) ? String(body.category) : "OTHER";
    const message = String(body?.message ?? "").trim().slice(0, 800);
    if (!message) return NextResponse.json({ error: "Describe the issue. The Engineer needs detail to act." }, { status: 400 });

    // Component must belong to the machine
    let componentName: string | null = null;
    const componentId = body?.componentId ? String(body.componentId) : null;
    if (componentId) {
      const comp = await db.component.findUnique({ where: { id: componentId } });
      if (!comp || comp.machineId !== machine.id) {
        return NextResponse.json({ error: "Component does not belong to this machine." }, { status: 400 });
      }
      componentName = comp.name;
    }

    // Linked work order must exist; artisans may only escalate on their own jobs
    let workOrderId: string | null = null;
    if (body?.workOrderId) {
      const wo = await db.workOrder.findUnique({ where: { id: String(body.workOrderId) } });
      if (!wo) return NextResponse.json({ error: "Work order not found." }, { status: 404 });
      if (user.role !== "ADMIN" && wo.assignedToId !== user.id) {
        return NextResponse.json({ error: "Not your work order." }, { status: 403 });
      }
      workOrderId = wo.id;
    }

    const photo = body?.photo ? String(body.photo).slice(0, 300) : null;

    // Severity auto-rating: safety first, blockers high, the rest normal
    const severity = category === "SAFETY" ? "CRITICAL" : category === "OTHER" ? "NORMAL" : "HIGH";

    const esc = await db.escalation.create({
      data: {
        machineId: machine.id, componentId, componentName, workOrderId,
        raisedById: user.id, category, message, photo, severity, status: "OPEN",
      },
    });

    return NextResponse.json({ ok: true, id: esc.id, severity });
  } catch {
    return NextResponse.json({ error: "Could not raise the escalation." }, { status: 500 });
  }
}

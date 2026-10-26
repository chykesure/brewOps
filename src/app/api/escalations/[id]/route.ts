import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isPriority } from "@/lib/types";

const CORRECTIVE_STEPS = [
  "Diagnose fault & isolate safely",
  "Repair / replace component",
  "Test run & verify fix",
  "Report findings in notes",
];

// PATCH /api/escalations/[id] — Engineer actions on an artisan escalation:
//   ack      — "seen, acting on it" (optional response note)
//   resolve  — handled, with a mandatory note on what was done
//   reroute  — reassign the linked work order to another artisan (trade-aware pick)
//   dispatch — QUICK FIX: fire an urgent corrective WO on the same machine
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    const esc = await db.escalation.findUnique({
      where: { id },
      include: { machine: true, workOrder: true, raisedBy: true },
    });
    if (!esc) return NextResponse.json({ error: "Escalation not found." }, { status: 404 });

    const note = body?.response ? String(body.response).trim().slice(0, 500) : null;

    switch (action) {
      case "ack": {
        await db.escalation.update({
          where: { id },
          data: {
            status: "ACK", handledById: user.id, handledAt: new Date(),
            response: note ?? "Acknowledged. Engineer is on it",
          },
        });
        break;
      }
      case "resolve": {
        if (!note) return NextResponse.json({ error: "A resolution note is required." }, { status: 400 });
        await db.escalation.update({
          where: { id },
          data: { status: "RESOLVED", handledById: user.id, handledAt: new Date(), response: note },
        });
        break;
      }
      case "reroute": {
        // Reassign the linked job to another artisan — the core "reroute the task" action
        if (!esc.workOrderId) {
          return NextResponse.json({ error: "No linked work order to reroute. Dispatch a quick-fix job instead." }, { status: 400 });
        }
        const assignedToId = body?.assignedToId ? String(body.assignedToId) : null;
        if (!assignedToId) return NextResponse.json({ error: "Pick the artisan to reroute to." }, { status: 400 });
        const target = await db.user.findUnique({ where: { id: assignedToId } });
        if (!target || target.role !== "ARTISAN" || !target.active) {
          return NextResponse.json({ error: "Target artisan not found or inactive." }, { status: 400 });
        }
        if (assignedToId === esc.workOrder?.assignedToId) {
          return NextResponse.json({ error: "The job is already assigned to that artisan." }, { status: 400 });
        }
        await db.workOrder.update({
          where: { id: esc.workOrderId },
          data: { assignedToId, status: "PENDING" }, // new owner re-accepts and re-checks-in on site
        });
        await db.escalation.update({
          where: { id },
          data: {
            status: "ACK", handledById: user.id, handledAt: new Date(), reroutedToId: assignedToId,
            response: note ?? `Job rerouted to ${target.name}`,
          },
        });
        return NextResponse.json({ ok: true, reroutedTo: target.name });
      }
      case "dispatch": {
        // QUICK FIX — create an urgent corrective WO on the same machine and link it back
        const priority = isPriority(String(body?.priority ?? "")) ? String(body.priority) : "HIGH";
        const dueHours = Number(body?.dueHours);
        const due = new Date(Date.now() + (isFinite(dueHours) && dueHours > 0 ? dueHours : 24) * 3600_000);
        const assignedToId = body?.assignedToId ? String(body.assignedToId) : null;
        if (assignedToId) {
          const target = await db.user.findUnique({ where: { id: assignedToId } });
          if (!target || target.role !== "ARTISAN" || !target.active) {
            return NextResponse.json({ error: "Target artisan not found or inactive." }, { status: 400 });
          }
        }
        const scope = esc.componentName ? `${esc.machine.code} · ${esc.componentName}` : esc.machine.code;
        const title = (body?.title ? String(body.title).trim() : "") || `Quick fix · ${scope}`;
        const description = [
          `Escalation by ${esc.raisedBy.name} (${esc.category.replace(/_/g, " ")}):`,
          esc.message,
        ].join("\n");

        const seq = await db.seq.upsert({ where: { key: "WO" }, create: { key: "WO", value: 1001 }, update: { value: { increment: 1 } } });
        const wo = await db.workOrder.create({
          data: {
            code: `WO-${seq.value}`,
            title: title.slice(0, 140),
            description: description.slice(0, 800),
            type: "CORRECTIVE",
            priority,
            source: "MANUAL",
            machineId: esc.machineId,
            assignedToId,
            createdById: user.id,
            status: "PENDING",
            dueDate: due,
            steps: { create: CORRECTIVE_STEPS.map((text, i) => ({ idx: i + 1, text })) },
          },
        });
        await db.escalation.update({
          where: { id },
          data: {
            status: "ACK", handledById: user.id, handledAt: new Date(), workOrderId: wo.id,
            response: note ?? `Quick-fix job ${wo.code} dispatched (${priority.toLowerCase()} priority)`,
          },
        });
        return NextResponse.json({ ok: true, woCode: wo.code });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Escalation action failed." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { mapWo } from "@/lib/bootstrap";
import type { PmArtisanSummary } from "@/lib/types";

// GET /api/machines/[id]/history — every PM carried on this machine + the artisans who took them.
// Admin: any machine. Artisan: only machines they own (floor ownership model).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const machine = await db.machine.findUnique({
      where: { id },
      include: { department: true, owner: true },
    });
    if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });

    if (user.role !== "ADMIN" && machine.ownerId !== user.id) {
      return NextResponse.json({ error: "You can only review machines assigned to you." }, { status: 403 });
    }

    const ordersRaw = await db.workOrder.findMany({
      where: { machineId: id, status: { not: "CANCELLED" } },
      include: { machine: true, assignedTo: true, createdBy: true, template: true, steps: { orderBy: { idx: "asc" } } },
      orderBy: [{ completedAt: "desc" }, { dueDate: "desc" }],
      take: 80,
    });
    const orders = ordersRaw.map(mapWo);

    // Artisan execution ledger — who took the PMs (and corrective jobs) on this machine
    const map = new Map<string, PmArtisanSummary>();
    for (const w of ordersRaw) {
      if (!w.assignedTo) continue;
      const isPm = w.type === "PM";
      if (!isPm && w.status !== "COMPLETED") continue;
      const cur = map.get(w.assignedTo.id) ?? {
        userId: w.assignedTo.id, name: w.assignedTo.name, trade: w.assignedTo.trade, shift: w.assignedTo.shift,
        pmCount: 0, correctiveCount: 0, lastPmAt: null as string | null, lastWoCode: null as string | null,
      };
      if (isPm) {
        cur.pmCount++;
        const stamp = (w.completedAt ?? w.dueDate).toISOString();
        if (!cur.lastPmAt || stamp > cur.lastPmAt) {
          cur.lastPmAt = stamp;
          cur.lastWoCode = w.code;
        }
      } else if (w.status === "COMPLETED") {
        cur.correctiveCount++;
      }
      map.set(w.assignedTo.id, cur);
    }
    const artisans = Array.from(map.values()).sort((a, b) => b.pmCount - a.pmCount || (b.lastPmAt ?? "").localeCompare(a.lastPmAt ?? ""));

    const pmOrders = orders.filter((w) => w.type === "PM");
    const completedPm = pmOrders.filter((w) => w.status === "COMPLETED");
    const d30 = new Date(Date.now() - 30 * 86400_000);
    const lastPm = completedPm.find((w) => w.completedAt) ?? null;

    return NextResponse.json({
      machine: {
        id: machine.id, code: machine.code, name: machine.name,
        departmentName: machine.department.name, location: machine.location,
        functionalLoc: machine.functionalLoc, equipmentNo: machine.equipmentNo,
        ownerName: machine.owner?.name ?? null,
      },
      orders,
      artisans,
      summary: {
        pmTotal: pmOrders.length,
        completedPm: completedPm.length,
        openPm: pmOrders.filter((w) => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(w.status)).length,
        pmsLast30d: completedPm.filter((w) => w.completedAt && new Date(w.completedAt) >= d30).length,
        lastPmAt: lastPm?.completedAt ?? null,
        lastPmCode: lastPm?.code ?? null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not load machine history." }, { status: 500 });
  }
}

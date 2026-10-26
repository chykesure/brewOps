import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import type { Status } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/components/[id] — full immutable history for one component
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;

  const component = await db.component.findUnique({
    where: { id },
    include: { machine: true },
  });
  if (!component) return NextResponse.json({ error: "Component not found." }, { status: 404 });

  if (user.role !== "ADMIN" && component.machine.ownerId !== user.id) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const logs = await db.statusLog.findMany({
    where: { componentId: id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    component: { id: component.id, name: component.name, partCode: component.partCode, machineCode: component.machine.code },
    logs: logs.map((l) => ({
      id: l.id, status: l.status as Status, note: l.note, photo: l.photo,
      userId: l.userId, userName: l.user.name, createdAt: l.createdAt.toISOString(),
    })),
  });
}

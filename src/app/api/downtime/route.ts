import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

// POST /api/downtime — open a downtime record (admin)
// PATCH /api/downtime — close a downtime record {id} (admin)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try {
    const { machineId, reason } = await req.json();
    if (!machineId) return NextResponse.json({ error: "machineId required." }, { status: 400 });
    const dt = await db.downtime.create({
      data: { machineId: String(machineId), reason: reason ? String(reason).slice(0, 300) : "Unplanned downtime", reportedById: user.id },
    });
    return NextResponse.json({ ok: true, id: dt.id });
  } catch {
    return NextResponse.json({ error: "Could not record downtime." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required." }, { status: 400 });
    await db.downtime.update({ where: { id: String(id) }, data: { endedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not close downtime." }, { status: 500 });
  }
}

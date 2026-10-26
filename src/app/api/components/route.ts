import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

// POST /api/components — register a component under a machine.
// The Engineer, or the artisan the machine is assigned to, can add components:
// the floor crew spots new sub-components (a second seal, a swapped motor) before anyone else.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    const body = await req.json();
    const { machineId, name, partCode, category, partId } = body ?? {};
    if (!machineId || !name) return NextResponse.json({ error: "machineId and name are required." }, { status: 400 });
    const machine = await db.machine.findUnique({ where: { id: String(machineId) } });
    if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
    if (user.role !== "ADMIN" && machine.ownerId !== user.id) {
      return NextResponse.json(
        { error: "Only the Engineer or the machine's assigned artisan can add components." },
        { status: 403 },
      );
    }
    const comp = await db.component.create({
      data: {
        machineId: machine.id,
        name: String(name).trim().slice(0, 80),
        partCode: partCode ? String(partCode).trim().slice(0, 30) : null,
        category: category ? String(category).trim().slice(0, 30) : null,
        partId: partId ? String(partId) : null,
        currentStatus: "WORKING",
      },
    });
    return NextResponse.json({ ok: true, id: comp.id });
  } catch {
    return NextResponse.json({ error: "Could not add the component." }, { status: 500 });
  }
}

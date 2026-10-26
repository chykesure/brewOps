import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { isPmCycle } from "@/lib/types";
import { deptPrefixFromName, nextMachineCode } from "@/lib/machine-code";

// POST /api/machines — register a machine.
// The Engineer registers from the Registry; Artisans register from the shop floor
// (they are the eyes of the plant and see new equipment first). A machine registered
// by an artisan is owned by that artisan, so it lands in their own round immediately;
// the Engineer can reassign or tune PM later in the Registry.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "ARTISAN") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { code, name, departmentId, departmentName, location, ownerId, pmCycle, pmDay } = body ?? {};
    if (!name) return NextResponse.json({ error: "Machine name is required." }, { status: 400 });

    // Department: explicit id, or a name typed on the floor (find-or-create, like bulk import)
    let dept: { id: string; name: string } | null = null;
    if (departmentId) dept = await db.department.findUnique({ where: { id: String(departmentId) } });
    if (!dept && departmentName) {
      const dName = String(departmentName).trim().slice(0, 60);
      if (dName) {
        dept = await db.department.upsert({ where: { name: dName }, update: {}, create: { name: dName } });
      }
    }
    if (!dept) return NextResponse.json({ error: "Pick a department (or type a new one)." }, { status: 400 });

    const isArtisan = user.role !== "ADMIN";

    // Code: client normally sends an auto-suggested one; if omitted (or blank)
    // the server generates the next free code from the department name so the
    // field never blocks a registration from the shop floor.
    let machineCode = String(code ?? "").trim().toUpperCase().slice(0, 20);
    if (!machineCode) {
      const all = await db.machine.findMany({ select: { code: true } });
      machineCode = nextMachineCode(deptPrefixFromName(dept.name), all.map((m) => m.code));
    }

    const machine = await db.machine.create({
      data: {
        code: machineCode,
        name: String(name).trim().slice(0, 80),
        departmentId: dept.id,
        location: location ? String(location).slice(0, 80) : null,
        ownerId: isArtisan ? user.id : ownerId ? String(ownerId) : null,
        pmCycle: isPmCycle(String(pmCycle)) ? String(pmCycle) : "WEEKLY",
        pmDay: Number.isFinite(Number(pmDay)) ? Math.min(31, Math.max(1, Number(pmDay))) : 1,
      },
    });
    return NextResponse.json({ ok: true, id: machine.id, code: machine.code });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "That machine code is already registered." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not register the machine." }, { status: 500 });
  }
}
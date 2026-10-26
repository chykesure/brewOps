import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, hashPin } from "@/lib/session";
import { newLicenseKey } from "@/lib/license";
import { isTrade } from "@/lib/types";

// GET /api/users — full team roster with load stats (admin)
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const users = await db.user.findMany({
    include: {
      assignedWorkOrders: { where: { status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS"] } }, select: { id: true } },
      ownedMachines: { select: { id: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role, trade: u.trade, shift: u.shift,
      active: u.active, openWos: u.assignedWorkOrders.length, machines: u.ownedMachines.length,
    })),
  });
}

// POST /api/users — the Engineer creates an Artisan account (name, email, PIN, trade)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const body = await req.json();
    const { name, email, pin, trade, shift } = body ?? {};

    const fullName = String(name ?? "").trim();
    const mail = String(email ?? "").trim().toLowerCase();
    const pinStr = String(pin ?? "").trim();

    if (!fullName || fullName.length < 3) return NextResponse.json({ error: "Artisan name is required." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
    if (!/^\d{4,6}$/.test(pinStr)) return NextResponse.json({ error: "PIN must be 4–6 digits." }, { status: 400 });
    if (!isTrade(String(trade))) return NextResponse.json({ error: "Trade must be MECHANICAL or ELECTRICAL." }, { status: 400 });

    const exists = await db.user.findUnique({ where: { email: mail } });
    if (exists) return NextResponse.json({ error: "A user with this email already exists." }, { status: 400 });

    // Optional home department — lands the artisan in a department-wide round at once
    let departmentId: string | null = null;
    if (body.departmentId) {
      const dept = await db.department.findUnique({ where: { id: String(body.departmentId) } });
      if (!dept) return NextResponse.json({ error: "Department not found." }, { status: 400 });
      departmentId = dept.id;
    }

    // Every registered artisan is issued a unique access license. The account
    // can sign in, but the license stays INACTIVE (activation notice pops up)
    // until the owner activates it from the developer console.
    const licenseKey = newLicenseKey();
    const created = await db.user.create({
      data: {
        name: fullName.slice(0, 80),
        email: mail,
        pinHash: hashPin(pinStr),
        role: "ARTISAN",
        trade: String(trade),
        shift: ["A", "B", "C"].includes(String(shift)) ? String(shift) : "A",
        active: true,
        departmentId,
        licenseKey,
        licenseActive: false,
      },
    });

    return NextResponse.json({ ok: true, id: created.id, name: created.name, licenseKey });
  } catch {
    return NextResponse.json({ error: "Could not create artisan." }, { status: 500 });
  }
}

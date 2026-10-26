import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, hashPin } from "@/lib/session";
import { isTrade } from "@/lib/types";

// PATCH /api/users/[id] — edit artisan: trade, shift, name, active, reset PIN (admin)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await ctx.params;

  try {
    const body = await req.json();
    const target = await db.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 3) return NextResponse.json({ error: "Name too short." }, { status: 400 });
      data.name = name.slice(0, 80);
    }
    if (body.departmentId !== undefined) {
      // Home department: the artisan sees & reports every machine in it
      const deptId = body.departmentId === null || body.departmentId === "" ? null : String(body.departmentId);
      if (deptId) {
        const dept = await db.department.findUnique({ where: { id: deptId } });
        if (!dept) return NextResponse.json({ error: "Department not found." }, { status: 400 });
      }
      data.departmentId = deptId;
    }
    if (body.trade !== undefined) {
      if (!isTrade(String(body.trade))) return NextResponse.json({ error: "Trade must be MECHANICAL or ELECTRICAL." }, { status: 400 });
      data.trade = String(body.trade);
    }
    if (body.shift !== undefined && ["A", "B", "C"].includes(String(body.shift))) data.shift = String(body.shift);
    if (body.active !== undefined) {
      if (target.id === user.id) return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
      data.active = Boolean(body.active);
    }
    if (body.resetPin !== undefined) {
      const pin = String(body.resetPin).trim();
      if (!/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–6 digits." }, { status: 400 });
      data.pinHash = hashPin(pin);
    }

    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    await db.user.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update user." }, { status: 500 });
  }
}

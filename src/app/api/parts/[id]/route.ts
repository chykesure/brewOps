import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

// PATCH /api/parts/[id] — adjust stock (admin)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const part = await db.part.findUnique({ where: { id } });
    if (!part) return NextResponse.json({ error: "Part not found." }, { status: 404 });
    const data: Record<string, number> = {};
    if (typeof body.stock === "number") data.stock = Math.max(0, Math.floor(body.stock));
    if (typeof body.delta === "number") data.stock = Math.max(0, part.stock + Math.floor(body.delta));
    if (typeof body.reorderLevel === "number") data.reorderLevel = Math.max(0, Math.floor(body.reorderLevel));
    await db.part.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Update failed." }, { status: 500 });
  }
}

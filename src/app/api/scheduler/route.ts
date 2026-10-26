import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { runScheduler } from "@/lib/scheduler";

// POST /api/scheduler — manual PM generation run (admin)
export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const result = await runScheduler();
  return NextResponse.json({ ok: true, ...result });
}

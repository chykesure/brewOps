import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET /api/dev/audit — the console's own operation trail (newest first),
// with per-action counts so the UI can build filter chips.
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const [events, total, grouped] = await Promise.all([
    db.devEvent.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    db.devEvent.count(),
    db.devEvent.groupBy({ by: ["action"], _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.action] = g._count._all;

  return NextResponse.json({ events, total, shown: events.length, counts });
}

// DELETE /api/dev/audit — wipe the audit trail (type-to-confirm WIPE).
// The wipe itself is recorded, so the trail always starts with a marker.
export async function DELETE(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let confirm = "";
  try {
    const body = await req.json();
    confirm = String(body?.confirm ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (confirm !== "WIPE") return NextResponse.json({ error: 'Type WIPE in the confirmation box first.' }, { status: 400 });

  const deleted = await db.devEvent.deleteMany({});
  await logDevEvent("AUDIT_CLEARED", `${deleted.count} prior event(s) wiped`);
  return NextResponse.json({ ok: true, deleted: deleted.count });
}

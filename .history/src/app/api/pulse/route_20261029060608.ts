import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/pulse — a few-hundred-byte revision fingerprint of the plant's data.
// Every dashboard polls this every few seconds; when the fingerprint moves the app
// silently re-fetches the bootstrap, so what the Engineer changes appears live on
// the Artisan screens and vice versa — the two-way live feed. Each component of the
// fingerprint mixes a max timestamp with a row count so both edits and inserts move it.
//
// Built with portable Prisma aggregates (not raw SQL) so the same fingerprint runs
// on PostgreSQL in production and SQLite in local development.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const [
      statusLog, woCreated, woUpdated, woSteps, checkIns, downtime,
      escalations, components, machinesCreated, machinesUpdated, parts, users,
    ] = await Promise.all([
      db.statusLog.aggregate({ _max: { createdAt: true }, _count: true }),
      db.workOrder.aggregate({ _max: { createdAt: true }, _count: true }),
      db.workOrder.aggregate({ _max: { updatedAt: true }, _count: true }),
      db.woStep.aggregate({ _max: { doneAt: true }, _count: true }),
      db.woCheckIn.aggregate({ _max: { createdAt: true }, _count: true }),
      db.downtime.aggregate({ _max: { startedAt: true, endedAt: true }, _count: true }),
      db.escalation.aggregate({ _max: { createdAt: true }, _count: true }),
      db.component.aggregate({ _max: { updatedAt: true }, _count: true }),
      db.machine.aggregate({ _max: { createdAt: true }, _count: true }),
      db.machine.aggregate({ _max: { updatedAt: true }, _count: true }),
      db.part.aggregate({ _max: { updatedAt: true }, _count: true }),
      db.user.aggregate({ _max: { updatedAt: true }, _count: true }),
    ]);

    const stamp = (d: Date | null, n: number) => `${d ? d.getTime() : 0}:${n}`;
    const rev = [
      stamp(statusLog._max.createdAt, statusLog._count),
      stamp(woCreated._max.createdAt, woCreated._count),
      stamp(woUpdated._max.updatedAt, woUpdated._count),
      stamp(woSteps._max.doneAt, woSteps._count),
      stamp(checkIns._max.createdAt, checkIns._count),
      stamp(downtime._max.endedAt ?? downtime._max.startedAt, downtime._count),
      stamp(escalations._max.createdAt, escalations._count),
      stamp(components._max.updatedAt, components._count),
      stamp(machinesCreated._max.createdAt, machinesCreated._count),
      stamp(machinesUpdated._max.updatedAt, machinesUpdated._count),
      stamp(parts._max.updatedAt, parts._count),
      stamp(users._max.updatedAt, users._count),
    ].join("|");

    return NextResponse.json({ rev, at: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Pulse failed." }, { status: 500 });
  }
}
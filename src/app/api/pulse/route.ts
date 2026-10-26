import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/pulse — a few-hundred-byte revision fingerprint of the plant's data.
// Every dashboard polls this every few seconds; when the fingerprint moves the app
// silently re-fetches the bootstrap, so what the Engineer changes appears live on
// the Artisan screens and vice versa — the two-way live feed. Each component of the
// fingerprint mixes a max timestamp with a row count so both edits and inserts move it.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const rows = await db.$queryRaw<{ rev: string }[]>`
      SELECT
        (SELECT COALESCE(MAX(createdAt), '1970-01-01') || ':' || COUNT(*) FROM StatusLog) || '|' ||
        (SELECT COALESCE(MAX(createdAt), '1970-01-01') || ':' || COUNT(*) FROM WorkOrder) || '|' ||
        (SELECT COALESCE(MAX(updatedAt), '1970-01-01') || ':' || COUNT(*) FROM WorkOrder) || '|' ||
        (SELECT COALESCE(MAX(doneAt), '1970-01-01') || ':' || COUNT(*) FROM WoStep) || '|' ||
        (SELECT COALESCE(MAX(createdAt), '1970-01-01') || ':' || COUNT(*) FROM WoCheckIn) || '|' ||
        (SELECT COALESCE(MAX(COALESCE(endedAt, startedAt)), '1970-01-01') || ':' || COUNT(*) FROM Downtime) || '|' ||
        (SELECT COALESCE(MAX(createdAt), '1970-01-01') || ':' || COUNT(*) FROM Escalation) || '|' ||
        (SELECT COALESCE(MAX(updatedAt), '1970-01-01') || ':' || COUNT(*) FROM Component) || '|' ||
        (SELECT COALESCE(MAX(createdAt), '1970-01-01') || ':' || COUNT(*) FROM Machine) || '|' ||
        (SELECT COALESCE(MAX(updatedAt), '1970-01-01') || ':' || COUNT(*) FROM Machine) || '|' ||
        (SELECT COALESCE(MAX(updatedAt), '1970-01-01') || ':' || COUNT(*) FROM Part) || '|' ||
        (SELECT COALESCE(MAX(updatedAt), '1970-01-01') || ':' || COUNT(*) FROM "User") AS rev`;
    return NextResponse.json({ rev: rows[0]?.rev ?? "0", at: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Pulse failed." }, { status: 500 });
  }
}

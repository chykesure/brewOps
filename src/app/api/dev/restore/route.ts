import { NextRequest, NextResponse } from "next/server";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { restoreSnapshot } from "@/lib/dev-data";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// POST /api/dev/restore — replace the entire database with a JSON snapshot.
// Body: { confirm: "RESTORE", backup: <the downloaded JSON object> }
export async function POST(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  try {
    const body = await req.json();
    if (body?.confirm !== "RESTORE") {
      return NextResponse.json({ error: 'Type RESTORE in the confirmation box first.' }, { status: 400 });
    }
    const restored = await restoreSnapshot(body.backup);
    const total = Object.values(restored).reduce((a, b) => a + b, 0);
    await logDevEvent("SNAPSHOT_RESTORED", `uploaded file · ${total} rows`);
    return NextResponse.json({ ok: true, restored });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Restore failed. The database was left untouched." },
      { status: 400 },
    );
  }
}

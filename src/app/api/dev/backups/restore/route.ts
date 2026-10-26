import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { restoreSnapshot } from "@/lib/dev-data";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// POST /api/dev/backups/restore — roll the whole database back to a stored
// restore point. Body: { file: "<name>.json", confirm: "RESTORE" }
export async function POST(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let file = "";
  let confirm = "";
  try {
    const body = await req.json();
    file = String(body?.file ?? "");
    confirm = String(body?.confirm ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(file) || file.includes("..")) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }
  if (confirm !== "RESTORE") {
    return NextResponse.json({ error: 'Type RESTORE in the confirmation box first.' }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await fs.readFile(path.join(process.cwd(), "db", "backups", file), "utf8");
  } catch {
    return NextResponse.json({ error: "Restore point not found on the server." }, { status: 404 });
  }

  try {
    const restored = await restoreSnapshot(JSON.parse(raw));
    const total = Object.values(restored).reduce((a, b) => a + b, 0);
    await logDevEvent("SNAPSHOT_RESTORED", `${file} · ${total} rows`);
    return NextResponse.json({ ok: true, restored });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Restore failed. The database was left untouched." },
      { status: 400 },
    );
  }
}

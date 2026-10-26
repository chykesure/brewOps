import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { snapshotAll } from "@/lib/dev-data";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// Server-stored restore points: one-click named snapshots kept on the server
// (db/backups/*.json) that can be restored straight from the console — no
// file juggling. The downloaded .db/.json files remain available alongside.

function backupsDir(): string {
  return path.join(process.cwd(), "db", "backups");
}

function safeName(file: string): string | null {
  // Defence against path traversal: plain names only, .json extension, no dots-in-a-row
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(file) || file.includes("..")) return null;
  return file;
}

interface BackupHeader {
  app?: string;
  exportedAt?: string;
  counts?: Record<string, number>;
}

async function readHeader(file: string): Promise<BackupHeader | null> {
  try {
    const raw = await fs.readFile(path.join(backupsDir(), file), "utf8");
    const json = JSON.parse(raw) as BackupHeader;
    return json?.app === "BrewOps" ? json : null;
  } catch {
    return null;
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// GET /api/dev/backups — list every stored restore point (newest first)
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  let files: string[] = [];
  try {
    files = (await fs.readdir(backupsDir())).filter((f) => f.endsWith(".json")).sort().reverse();
  } catch {
    files = [];
  }

  const backups = await Promise.all(
    files.map(async (file) => {
      const full = path.join(backupsDir(), file);
      let size = 0;
      try {
        size = (await fs.stat(full)).size;
      } catch { /* vanished between readdir and stat */ }
      const header = await readHeader(file);
      const counts = header?.counts ?? {};
      return {
        file,
        size,
        createdAt: header?.exportedAt ?? (await fs.stat(full).then((s) => s.mtime.toISOString()).catch(() => new Date(0).toISOString())),
        rows: Object.values(counts).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0),
        counts,
      };
    }),
  );

  return NextResponse.json({ backups });
}

// POST /api/dev/backups — capture a restore point NOW
export async function POST(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  const { data, counts } = await snapshotAll();
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  const file = `brewops-snapshot-${stamp()}.json`;
  await fs.mkdir(backupsDir(), { recursive: true });
  await fs.writeFile(
    path.join(backupsDir(), file),
    JSON.stringify({ app: "BrewOps", version: 1, exportedAt: new Date().toISOString(), counts, data }, null, 2),
  );
  await logDevEvent("SNAPSHOT_CREATED", `${file} · ${rows} rows`);
  return NextResponse.json({ ok: true, file, rows, counts });
}

// DELETE /api/dev/backups?file=<name>.json — remove one restore point
export async function DELETE(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  const file = safeName(req.nextUrl.searchParams.get("file") ?? "");
  if (!file) return NextResponse.json({ error: "Invalid file name." }, { status: 400 });

  try {
    await fs.unlink(path.join(backupsDir(), file));
  } catch {
    return NextResponse.json({ error: "Restore point not found." }, { status: 404 });
  }
  await logDevEvent("SNAPSHOT_DELETED", file);
  return NextResponse.json({ ok: true });
}

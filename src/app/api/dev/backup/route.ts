import { NextRequest, NextResponse } from "next/server";
import { promises as fs, existsSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { snapshotAll } from "@/lib/dev-data";

export const dynamic = "force-dynamic";

function isPostgres(): boolean {
  return /^postgres/i.test(process.env.DATABASE_URL ?? "");
}

function dbFilePath(): string {
  const url = process.env.DATABASE_URL || "file:../db/custom.db";
  const raw = url.startsWith("file:") ? url.slice(5) : url;
  if (path.isAbsolute(raw)) return raw;
  // Prisma resolves relative file: URLs against the schema dir (prisma/);
  // probe that first, then fall back to the older project-root style.
  const schemaRel = path.resolve(process.cwd(), "prisma", raw);
  if (existsSync(schemaRel)) return schemaRel;
  return path.resolve(process.cwd(), raw);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// GET /api/dev/backup?format=db    → raw database file (SQLite mode only;
//                                    on PostgreSQL this serves the JSON snapshot,
//                                    because cloud data has no file on disk)
// GET /api/dev/backup?format=json  → full-table JSON snapshot (restorable, both engines)
export async function GET(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const format = req.nextUrl.searchParams.get("format") ?? "json";

  if (format === "db" && !isPostgres()) {
    // Flush the WAL into the main file so the copy is complete and portable.
    await db.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
    const file = dbFilePath();
    const buf = await fs.readFile(file);
    await logDevEvent("BACKUP_DB", `${buf.length} bytes`);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="brewops-backup-${stamp()}.db"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  }

  // JSON snapshot — the portable backup that works on every engine.
  const { data, counts } = await snapshotAll();
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  await logDevEvent("BACKUP_JSON", `${rows} rows`);
  return new NextResponse(
    JSON.stringify({ app: "BrewOps", version: 1, exportedAt: new Date().toISOString(), counts, data }, null, 2),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="brewops-backup-${stamp()}.json"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
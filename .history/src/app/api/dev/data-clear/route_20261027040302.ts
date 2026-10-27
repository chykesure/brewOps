import { NextRequest, NextResponse } from "next/server";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { clearCounts, clearEntity, machineClearList } from "@/lib/dev-data";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// Photo storage — component photos, check-in evidence and avatars land here.
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

async function photoStats(): Promise<{ files: number; bytes: number }> {
  try {
    const entries = await readdir(UPLOAD_DIR);
    let files = 0;
    let bytes = 0;
    for (const f of entries) {
      try {
        const s = await stat(path.join(UPLOAD_DIR, f));
        if (s.isFile()) {
          files += 1;
          bytes += s.size;
        }
      } catch {
        // a file vanishing between readdir and stat is fine
      }
    }
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

// GET /api/dev/data-clear — live counts per entity + the machine picker list.
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const [counts, machines, photos] = await Promise.all([clearCounts(), machineClearList(), photoStats()]);
  return NextResponse.json({ counts, machines, photos });
}

// POST /api/dev/data-clear — wipe ONE entity.
// Body: { entity, machineId?, confirm: "DELETE" }
export async function POST(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let entity = "";
  let machineId: string | undefined;
  let confirm = "";
  try {
    const body = await req.json();
    entity = String(body?.entity ?? "");
    machineId = typeof body?.machineId === "string" ? body.machineId : undefined;
    confirm = String(body?.confirm ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (confirm !== "DELETE") {
    return NextResponse.json({ error: 'Type DELETE in the confirmation box first.' }, { status: 400 });
  }

  // Photo storage is files on disk, not table rows — handled here.
  if (entity === "photos") {
    try {
      const entries = await readdir(UPLOAD_DIR);
      for (const f of entries) {
        await rm(path.join(UPLOAD_DIR, f), { force: true }).catch(() => null);
      }
    } catch {
      // missing directory = nothing to wipe
    }
    await logDevEvent("DATA_CLEARED", "photos · uploaded files wiped");
    return NextResponse.json({ ok: true, deleted: { photos: 1 } });
  }

  if (entity === "machineComponents" || entity === "machine") {
    if (!machineId) return NextResponse.json({ error: "Pick a machine first." }, { status: 400 });
    const target = await db.machine.findUnique({ where: { id: machineId }, select: { code: true, name: true } });
    if (!target) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
    try {
      const deleted = await clearEntity(entity, machineId);
      const total = Object.values(deleted).reduce((a, b) => a + b, 0);
      await logDevEvent("DATA_CLEARED", `${entity} · ${target.code} ${target.name} · ${total} record(s)`);
      return NextResponse.json({ ok: true, deleted });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Wipe failed." }, { status: 500 });
    }
  }

  try {
    const deleted = await clearEntity(entity);
    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    await logDevEvent("DATA_CLEARED", `${entity} · ${total} record(s)`);
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Wipe failed." }, { status: 400 });
  }
}
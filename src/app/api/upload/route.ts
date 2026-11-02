import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getSessionContext } from "@/lib/session";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// POST /api/upload — saves a photo (avatar, company logo, work-order evidence,
// check-in proof) and returns the URL it is served from.
//
// Files are written to public/uploads (symlinked to /data/uploads on the
// server) and are ALWAYS served through /api/files/<name> — the Next.js
// standalone server indexes the public folder once at boot, so files that
// appear later would 404 as static assets. An API route never has that
// problem, which is exactly why profile photos "did not show" before.

const MAX_BYTES = 3_000_000; // 3 MB
const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file received." }, { status: 400 });

    const ext = EXT_FOR_TYPE[file.type];
    if (!ext) return NextResponse.json({ error: "Only JPG, PNG or WebP images are allowed." }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image is too large (max 3 MB). Pick a smaller photo." }, { status: 413 });
    }

    const name = `${Date.now().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 12)}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ ok: true, url: `/api/files/${name}` });
  } catch {
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }
}
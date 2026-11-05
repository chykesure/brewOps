import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

// GET /api/files/<name> — serves uploaded photos (avatars, company logos,
// work-order evidence, check-in proofs).
//
// Uploaded files land in public/uploads, but the production (standalone)
// server only indexes that folder once at boot — files uploaded afterwards
// would 404 as static assets. This route reads from disk on every request,
// so a photo is served the moment its upload finishes.

const TYPE_FOR_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  // Strict filename check — blocks traversal ("..", slashes, odd characters).
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPE_FOR_EXT[ext];
  if (!type) return NextResponse.json({ error: "Unknown file type." }, { status: 400 });

  try {
    const dir = path.join(process.cwd(), "public", "uploads");
    const full = path.resolve(dir, path.basename(name));
    // Defense in depth: the resolved path must stay inside the uploads dir.
    if (!full.startsWith(path.resolve(dir) + path.sep)) {
      return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
    }
    const buf = await readFile(full);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
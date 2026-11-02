import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext } from "@/lib/session";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// PATCH /api/profile — self-service profile edits: display name + avatar photo
export async function PATCH(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 3) return NextResponse.json({ error: "Name is too short." }, { status: 400 });
      data.name = name.slice(0, 80);
    }

    if (body.avatarUrl !== undefined) {
      const url = body.avatarUrl === null ? null : String(body.avatarUrl);
      if (url && !url.startsWith("/uploads/") && !url.startsWith("data:image/")) {
        return NextResponse.json({ error: "Avatar must be an uploaded image." }, { status: 400 });
      }
      if (url && url.startsWith("data:image/") && url.length > 700_000) {
        return NextResponse.json({ error: "Image is too large. Pick a smaller photo." }, { status: 400 });
      }
      data.avatarUrl = url;
    }

    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    const updated = await db.user.update({ where: { id: ctx.user.id }, data });
    return NextResponse.json({ ok: true, name: updated.name, avatarUrl: updated.avatarUrl });
  } catch {
    return NextResponse.json({ error: "Could not update the profile." }, { status: 500 });
  }
}

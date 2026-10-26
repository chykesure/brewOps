import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// Organisation identity & multi-site scaffolding.
// Settings keys: orgName, logoUrl. Branches: company sites (nationwide scale).
// Every signed-in user can read the identity (reports need it); only the
// Engineer (ADMIN) can change it.

async function readSettings(keys: string[]): Promise<Record<string, string | null>> {
  const rows = await db.settings.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = rows.find((r) => r.key === k)?.value ?? null;
  return out;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [s, branches] = await Promise.all([
    readSettings(["orgName", "logoUrl"]),
    db.branch.findMany({ orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({
    orgName: s.orgName, logoUrl: s.logoUrl,
    branches: branches.map((b) => ({ id: b.id, name: b.name, location: b.location, active: b.active })),
  });
}

export async function PATCH(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const body = await req.json();

    if (body.orgName !== undefined) {
      const name = String(body.orgName).trim().slice(0, 120);
      await db.settings.upsert({ where: { key: "orgName" }, update: { value: name }, create: { key: "orgName", value: name } });
    }
    if (body.logoUrl !== undefined) {
      const url = body.logoUrl === null ? "" : String(body.logoUrl);
      if (url && !url.startsWith("/uploads/")) {
        return NextResponse.json({ error: "The logo must be an uploaded image." }, { status: 400 });
      }
      await db.settings.upsert({ where: { key: "logoUrl" }, update: { value: url }, create: { key: "logoUrl", value: url } });
    }
    if (body.branch && typeof body.branch === "object") {
      const b = body.branch as { id?: string; name?: string; location?: string | null; active?: boolean };
      if (b.id) {
        const existing = await db.branch.findUnique({ where: { id: String(b.id) } });
        if (!existing) return NextResponse.json({ error: "Branch not found." }, { status: 404 });
        await db.branch.update({
          where: { id: existing.id },
          data: {
            ...(b.name !== undefined ? { name: String(b.name).trim().slice(0, 80) } : {}),
            ...(b.location !== undefined ? { location: b.location ? String(b.location).trim().slice(0, 120) : null } : {}),
            ...(b.active !== undefined ? { active: Boolean(b.active) } : {}),
          },
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update the organisation settings." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim().slice(0, 80);
    if (name.length < 2) return NextResponse.json({ error: "Branch name is required." }, { status: 400 });
    const location = body?.location ? String(body.location).trim().slice(0, 120) : null;

    const exists = await db.branch.findUnique({ where: { name } });
    if (exists) return NextResponse.json({ error: "A branch with this name already exists." }, { status: 400 });

    const branch = await db.branch.create({ data: { name, location } });
    return NextResponse.json({ ok: true, id: branch.id, name: branch.name });
  } catch {
    return NextResponse.json({ error: "Could not create the branch." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { logDevEvent } from "@/lib/dev-audit";
import { newLicenseKey } from "@/lib/license";
import { sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET /api/dev/licenses — every account with its license key + activation state
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const users = await db.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, trade: true, shift: true, active: true,
      licenseKey: true, licenseActive: true, createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ users });
}

// PATCH /api/dev/licenses
//   { userId, licenseActive }          → activate / deactivate one account
//   { userId, regenerate: true }       → issue a fresh key for one account
//   { fillMissing: true }              → issue keys for every account without one
export async function PATCH(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });

  let body: { userId?: string; licenseActive?: boolean; regenerate?: boolean; fillMissing?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (body.fillMissing) {
    const missing = await db.user.findMany({ where: { licenseKey: null }, select: { id: true } });
    for (const u of missing) {
      await db.user.update({ where: { id: u.id }, data: { licenseKey: newLicenseKey() } });
    }
    await logDevEvent("LICENSE_FILL", `${missing.length} key(s) issued`);
    return NextResponse.json({ ok: true, filled: missing.length });
  }

  if (!body.userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const user = await db.user.findUnique({ where: { id: body.userId } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  if (body.regenerate) {
    const licenseKey = newLicenseKey();
    await db.user.update({ where: { id: user.id }, data: { licenseKey } });
    await logDevEvent("LICENSE_REGENERATE", `${user.email} · new key ${licenseKey}`);
    return NextResponse.json({ ok: true, licenseKey });
  }

  if (typeof body.licenseActive === "boolean") {
    await db.user.update({ where: { id: user.id }, data: { licenseActive: body.licenseActive } });
    await logDevEvent(body.licenseActive ? "LICENSE_ACTIVATE" : "LICENSE_DEACTIVATE", user.email);
    return NextResponse.json({ ok: true, licenseActive: body.licenseActive });
  }

  return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
}

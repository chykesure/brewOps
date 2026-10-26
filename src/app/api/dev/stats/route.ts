import { NextResponse } from "next/server";
import { promises as fs, existsSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

// GET /api/dev/stats — the console's overview counters (database + license state)
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const [
    users, artisans, admins, machines, components, statusLogs, workOrders, openWorkOrders,
    downtimes, parts, escalations, devices, unlicensed, inactiveLicenses, activeSessions,
    maintenanceRow, quickSignInRow,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: "ARTISAN" } }),
    db.user.count({ where: { role: "ADMIN" } }),
    db.machine.count(),
    db.component.count(),
    db.statusLog.count(),
    db.workOrder.count(),
    db.workOrder.count({ where: { status: { in: ["PENDING", "ACCEPTED", "IN_PROGRESS"] } } }),
    db.downtime.count(),
    db.part.count(),
    db.escalation.count(),
    db.device.count(),
    db.user.count({ where: { licenseKey: null } }),
    db.user.count({ where: { licenseActive: false } }),
    db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    db.settings.findUnique({ where: { key: "maintenanceMode" } }),
    db.settings.findUnique({ where: { key: "quickSignIn" } }),
  ]);

  let dbSize = 0;
  try {
    const url = process.env.DATABASE_URL || "file:../db/custom.db";
    const raw = url.startsWith("file:") ? url.slice(5) : url;
    let file = raw;
    if (!path.isAbsolute(raw)) {
      // Prisma resolves relative file: URLs against the schema dir (prisma/);
      // probe that first, then fall back to the older project-root style.
      const schemaRel = path.resolve(process.cwd(), "prisma", raw);
      file = existsSync(schemaRel) ? schemaRel : path.resolve(process.cwd(), raw);
    }
    dbSize = (await fs.stat(file)).size;
  } catch {
    dbSize = 0;
  }

  return NextResponse.json({
    users, artisans, admins, machines, components, statusLogs, workOrders, openWorkOrders,
    downtimes, parts, escalations, devices, unlicensed, inactiveLicenses, dbSize,
    activeSessions, maintenance: maintenanceRow?.value === "on",
    quickSignIn: quickSignInRow?.value !== "off",
  });
}

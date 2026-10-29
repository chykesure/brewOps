import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDevUnlocked } from "@/lib/dev-auth";
import { hashPin } from "@/lib/session";
import { newLicenseKey } from "@/lib/license";
import { isTrade } from "@/lib/types";
import { logDevEvent } from "@/lib/dev-audit";

export const dynamic = "force-dynamic";

// /api/dev/accounts — the owner's account desk. Lives behind the dev-console
// PIN cookie (no user session required), so the very FIRST account can be
// minted on a brand-new/empty database — bootstrap without a seed script.
//   GET    → full roster with load + trust stats
//   POST   → create an account (ENGINEER or ARTISAN), license issued & active
//   PATCH  → { action: "update" } edit profile/role/active · { action: "pin" } reset PIN
//   DELETE → remove an artisan (with confirm word) + all their footprint

const OPEN_WO = ["PENDING", "ACCEPTED", "IN_PROGRESS"];

// GET /api/dev/accounts — roster with per-account counters
export async function GET() {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  const users = await db.user.findMany({
    include: {
      assignedWorkOrders: { where: { status: { in: OPEN_WO } }, select: { id: true } },
      ownedMachines: { select: { id: true } },
      sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } },
      devices: { select: { id: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      trade: u.trade, shift: u.shift, active: u.active,
      licenseKey: u.licenseKey, licenseActive: u.licenseActive,
      hasPassword: !!u.passwordHash, pwdChangedAt: u.pwdChangedAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      openWos: u.assignedWorkOrders.length, machines: u.ownedMachines.length,
      devices: u.devices.length, liveSessions: u.sessions.length,
    })),
  });
}

// POST /api/dev/accounts — mint an account. The sync password starts equal to
// the PIN (same rule as the seed and Team registration), so a brand-new user
// can sign in and synchronise their first device immediately.
export async function POST(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  try {
    const body = await req.json();
    const fullName = String(body?.name ?? "").trim();
    const mail = String(body?.email ?? "").trim().toLowerCase();
    const pinStr = String(body?.pin ?? "").trim();
    const role = body?.role === "ADMIN" ? "ADMIN" : "ARTISAN";
    const trade = body?.trade ? String(body.trade) : null;
    const shift = ["A", "B", "C"].includes(String(body?.shift)) ? String(body.shift) : "A";

    if (fullName.length < 3) return NextResponse.json({ error: "Full name is required (min 3 characters)." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return NextResponse.json({ error: "A valid work email is required." }, { status: 400 });
    if (!/^\d{4,6}$/.test(pinStr)) return NextResponse.json({ error: "PIN must be 4–6 digits." }, { status: 400 });
    if (role === "ARTISAN" && !isTrade(String(trade))) {
      return NextResponse.json({ error: "Artisans need a trade (MECHANICAL or ELECTRICAL)." }, { status: 400 });
    }

    const exists = await db.user.findUnique({ where: { email: mail } });
    if (exists) return NextResponse.json({ error: "A user with this email already exists." }, { status: 400 });

    const licenseKey = newLicenseKey();
    const created = await db.user.create({
      data: {
        name: fullName.slice(0, 80),
        email: mail,
        pinHash: hashPin(pinStr),
        passwordHash: hashPin(pinStr), // sync password starts equal to the PIN
        role,
        trade: role === "ARTISAN" ? trade : null,
        shift,
        active: true,
        licenseKey,
        licenseActive: true, // created by the owner directly — issued ready to work
      },
    });

    await logDevEvent("ACCOUNT_CREATE", `${role} ${mail}`);
    return NextResponse.json({ ok: true, id: created.id, name: created.name, role: created.role, licenseKey });
  } catch {
    return NextResponse.json({ error: "Could not create the account." }, { status: 500 });
  }
}

// PATCH /api/dev/accounts — edit an account or reset its PIN.
// A PIN reset also resets the device sync password back to the new PIN and
// signs the person out everywhere (standard recovery procedure).
export async function PATCH(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  try {
    const body = await req.json();
    const userId = String(body?.userId ?? "");
    const action = String(body?.action ?? "update");

    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    if (action === "pin") {
      const pinStr = String(body?.pin ?? "").trim();
      if (!/^\d{4,6}$/.test(pinStr)) return NextResponse.json({ error: "New PIN must be 4–6 digits." }, { status: 400 });

      await db.$transaction([
        db.user.update({
          where: { id: userId },
          data: { pinHash: hashPin(pinStr), passwordHash: hashPin(pinStr), pwdChangedAt: null },
        }),
        // recovery protocol: kill every live session so stale devices re-sync
        db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await logDevEvent("ACCOUNT_PIN_RESET", target.email);
      return NextResponse.json({ ok: true });
    }

    // ---- action === "update" ----
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const fullName = String(body.name).trim();
      if (fullName.length < 3) return NextResponse.json({ error: "Full name is required (min 3 characters)." }, { status: 400 });
      data.name = fullName.slice(0, 80);
    }
    if (body.email !== undefined) {
      const mail = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return NextResponse.json({ error: "A valid work email is required." }, { status: 400 });
      const clash = await db.user.findUnique({ where: { email: mail } });
      if (clash && clash.id !== userId) return NextResponse.json({ error: "Another account already uses this email." }, { status: 400 });
      data.email = mail;
    }
    if (body.role !== undefined) {
      if (body.role !== "ADMIN" && body.role !== "ARTISAN") return NextResponse.json({ error: "Role must be ADMIN or ARTISAN." }, { status: 400 });
      data.role = body.role;
    }
    if (body.trade !== undefined) data.trade = body.trade === null || body.trade === "" ? null : String(body.trade);
    if (body.shift !== undefined && ["A", "B", "C"].includes(String(body.shift))) data.shift = String(body.shift);
    if (body.active !== undefined) data.active = !!body.active;

    const nextRole = (data.role as string) ?? target.role;
    const nextTrade = data.trade !== undefined ? (data.trade as string | null) : target.trade;
    if (nextRole === "ARTISAN" && !isTrade(String(nextTrade))) {
      return NextResponse.json({ error: "Artisans need a trade (MECHANICAL or ELECTRICAL)." }, { status: 400 });
    }

    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    await db.user.update({ where: { id: userId }, data });
    await logDevEvent("ACCOUNT_UPDATE", `${target.email} · ${Object.keys(data).join(", ")}`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update the account." }, { status: 500 });
  }
}

// DELETE /api/dev/accounts — remove an ARTISAN and their whole footprint.
// Engineer (ADMIN) accounts are refused — the owner cannot lock themselves out
// of the plant by accident. Requires the typed confirmation word DELETE.
export async function DELETE(req: NextRequest) {
  if (!(await isDevUnlocked())) return NextResponse.json({ error: "Developer console is locked." }, { status: 401 });

  try {
    const body = await req.json();
    const userId = String(body?.userId ?? "");
    const confirm = String(body?.confirm ?? "");

    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (target.role === "ADMIN") {
      return NextResponse.json({ error: "Engineer accounts cannot be deleted here." }, { status: 400 });
    }
    if (confirm !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });

    // Database-enforced foreign keys (PostgreSQL) — children go first, in order.
    const deleted = await db.$transaction(async (tx) => {
      const out: Record<string, number> = {};
      // 1. Work orders they CREATED (steps + every check-in on them cascade away)
      out.createdWorkOrders = (await tx.workOrder.deleteMany({ where: { createdById: userId } })).count;
      // 2. Work orders merely ASSIGNED to them are unassigned, not destroyed
      out.unassignedWorkOrders = (await tx.workOrder.updateMany({ where: { assignedToId: userId }, data: { assignedToId: null } })).count;
      // 3–6. Their personal footprint
      out.checkIns = (await tx.woCheckIn.deleteMany({ where: { userId } })).count;
      out.statusLogs = (await tx.statusLog.deleteMany({ where: { userId } })).count;
      out.downtimes = (await tx.downtime.deleteMany({ where: { reportedById: userId } })).count;
      out.escalations = (await tx.escalation.deleteMany({ where: { raisedById: userId } })).count;
      // 7–8. Trust + sessions, then the account itself
      out.sessions = (await tx.session.deleteMany({ where: { userId } })).count;
      out.devices = (await tx.device.deleteMany({ where: { userId } })).count;
      await tx.user.delete({ where: { id: userId } });
      return out;
    });

    await logDevEvent("ACCOUNT_DELETE", `${target.email} · ${Object.values(deleted).reduce((a, b) => a + b, 0)} rows`);
    return NextResponse.json({ ok: true, deleted });
  } catch {
    return NextResponse.json({ error: "Could not delete the account." }, { status: 500 });
  }
}
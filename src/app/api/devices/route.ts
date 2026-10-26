import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext, revokeAllSessionsFor, revokeSession } from "@/lib/session";
import { clientIp, logSecurityEvent, sameOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";

// GET /api/devices — the Security module payload: trusted devices, live sessions,
// and this account's security event feed.
export async function GET(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const devices = await db.device.findMany({
    where: { userId: ctx.user.id },
    orderBy: [{ approved: "desc" }, { lastSeenAt: "desc" }],
  });
  const sessions = await db.session.findMany({
    where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { device: true },
    orderBy: { lastSeenAt: "desc" },
  });
  const events = await db.securityEvent.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return NextResponse.json({
    currentSessionId: ctx.session.id,
    devices: devices.map((d) => ({
      id: d.id, name: d.name, platform: d.platform, mobile: d.mobile,
      approved: d.approved, lastSeenAt: d.lastSeenAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
      isCurrent: sessions.some((s) => s.deviceId === d.id),
    })),
    sessions: sessions.map((s) => ({
      id: s.id, deviceName: s.device?.name ?? "Unknown device",
      ip: s.ip, lastSeenAt: s.lastSeenAt.toISOString(), createdAt: s.createdAt.toISOString(),
      isCurrent: s.id === ctx.session.id,
    })),
    events: events.map((e) => ({
      id: e.id, kind: e.kind, detail: e.detail, ip: e.ip, createdAt: e.createdAt.toISOString(),
    })),
  });
}

// PATCH /api/devices — device & session management actions from the Security module
export async function PATCH(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "revokeDevice") {
      const device = await db.device.findUnique({ where: { id: String(body.deviceId ?? "") } });
      if (!device || device.userId !== ctx.user.id) {
        return NextResponse.json({ error: "Device not found." }, { status: 404 });
      }
      await db.device.update({ where: { id: device.id }, data: { approved: false } });
      // Kill every live session riding on that device
      const riding = await db.session.findMany({ where: { deviceId: device.id, revokedAt: null } });
      for (const s of riding) await revokeSession(s.id);
      await logSecurityEvent({
        userId: ctx.user.id, email: ctx.user.email, kind: "DEVICE_REVOKED",
        detail: `Device removed: ${device.name}`, ip: clientIp(req), ua: req.headers.get("user-agent") ?? "",
      });
      return NextResponse.json({ ok: true, signedOutSessions: riding.length });
    }

    if (action === "approveDevice") {
      // Approving from an already-trusted session is the alternative sync path
      const device = await db.device.findUnique({ where: { id: String(body.deviceId ?? "") } });
      if (!device || device.userId !== ctx.user.id) {
        return NextResponse.json({ error: "Device not found." }, { status: 404 });
      }
      await db.device.update({ where: { id: device.id }, data: { approved: true, approvedAt: new Date() } });
      await logSecurityEvent({
        userId: ctx.user.id, email: ctx.user.email, kind: "DEVICE_SYNCED",
        detail: `Approved from a trusted session: ${device.name}`, ip: clientIp(req), ua: req.headers.get("user-agent") ?? "",
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "signOutOthers") {
      const count = await revokeAllSessionsFor(ctx.user.id, ctx.session.id);
      await logSecurityEvent({
        userId: ctx.user.id, email: ctx.user.email, kind: "LOGOUT_ALL",
        detail: `Signed out ${count} other session(s)`, ip: clientIp(req), ua: req.headers.get("user-agent") ?? "",
      });
      return NextResponse.json({ ok: true, signedOut: count });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Device action failed." }, { status: 500 });
  }
}

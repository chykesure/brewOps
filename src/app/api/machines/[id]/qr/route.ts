import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

// GET /api/machines/[id]/qr — SVG QR code encoding the machine's nameplate check-in code.
// Engineer-only: it is printed and stuck on the machine; artisans scan it on the floor.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const { id } = await ctx.params;
  const machine = await db.machine.findUnique({ where: { id } });
  if (!machine) return NextResponse.json({ error: "Machine not found." }, { status: 404 });
  if (!machine.checkinCode) {
    return NextResponse.json({ error: "No nameplate code set yet. Register one in the machine editor first." }, { status: 400 });
  }

  const svg = await QRCode.toString(machine.checkinCode, {
    type: "svg",
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
    color: { dark: "#111111", light: "#ffffff" },
  });

  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
  });
}

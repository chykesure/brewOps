import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { readOrg } from "@/lib/org";
import { STATUS_META } from "@/lib/status";
import { zonedDayBounds } from "@/lib/time";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/export?date=YYYY-MM-DD            → daily round CSV
// GET /api/export?from=YYYY-MM-DD&to=...     → full history CSV (audit export)
// Every file opens with a controlled-document heading block (company, report title,
// document ref, printed by/on) so the sheet identifies itself in Excel.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  const from = sp.get("from");
  const to = sp.get("to");
  const tz = sp.get("tz");

  const where: Record<string, unknown> = {};
  let periodLine = "";
  if (date) {
    // Day bounds on the requesting device's wall clock (Africa/Lagos etc.)
    const { start: b, end: e } = zonedDayBounds(date, tz);
    where.createdAt = { gte: b, lte: e };
    const dateLong = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    periodLine = `Report date: ${dateLong}`;
  } else if (from || to) {
    const fb = from ? zonedDayBounds(from, tz) : null;
    const tb = to ? zonedDayBounds(to, tz) : null;
    where.createdAt = {
      ...(fb ? { gte: fb.start } : {}),
      ...(tb ? { lte: tb.end } : {}),
    };
    periodLine = `Period: ${from ?? "beginning"} to ${to ?? "now"}`;
  }

  const [logs, org] = await Promise.all([
    db.statusLog.findMany({
      where,
      include: { user: true, component: { include: { machine: { include: { department: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    readOrg(),
  ]);
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz || undefined }).format(new Date());

  const rows: string[] = [
    `${org.name} · Daily Machine Status & Maintenance Report`,
    periodLine,
    "Document Ref: IB-ENG-DR-001 · Rev 02 · Classification: Internal Use",
    `Printed by: ${user.name} · Printed on: ${when}`,
    "",
    ["Timestamp", "Department", "Machine Code", "Machine", "Component", "Part Code", "Category", "Status", "Reported By", "Note"].join(","),
  ];
  for (const l of logs) {
    rows.push([
      l.createdAt.toISOString(),
      l.component.machine.department.name,
      l.component.machine.code,
      l.component.machine.name,
      l.component.name,
      l.component.partCode ?? "",
      l.component.category ?? "",
      STATUS_META[l.status as keyof typeof STATUS_META]?.label ?? l.status,
      l.user.name,
      l.note ?? "",
    ].map(csvEscape).join(","));
  }

  const filename = date ? `brewops-round-${date}.csv` : `brewops-history-${from ?? "start"}_${to ?? "now"}.csv`;
  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

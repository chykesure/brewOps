import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { readOrg } from "@/lib/org";
import { STATUS_META } from "@/lib/status";
import { zonedDayBounds } from "@/lib/time";

export const dynamic = "force-dynamic";

const HEADER_FILL = "FF1F2937"; // dark slate
const OK_FILL = "FFECFDF5";
const WARN_FILL = "FFFFF7ED";
const BAD_FILL = "FFFEF2F2";
const TITLE_ROWS = 4; // org name · report title · document-control line · blank

type SheetSpec = { name: string; columns: Partial<ExcelJS.Column>[]; rows: (string | number | null)[][] };

function colLetter(i: number): string {
  let s = "";
  while (i > 0) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// Formal document heading on top of every sheet: company name, report title,
// document-control line, then a blank spacer row before the column headers.
function addTitleBlock(ws: ExcelJS.Worksheet, cols: number, org: string, title: string, docLine: string) {
  ws.insertRows(1, [[org], [title], [docLine], [""]]);
  const last = colLetter(cols);
  ws.mergeCells(`A1:${last}1`);
  ws.mergeCells(`A2:${last}2`);
  ws.mergeCells(`A3:${last}3`);
  const r1 = ws.getRow(1);
  r1.font = { bold: true, size: 14, color: { argb: "FF111111" } };
  r1.alignment = { vertical: "middle", horizontal: "left" };
  r1.height = 22;
  const r2 = ws.getRow(2);
  r2.font = { bold: true, size: 11.5, color: { argb: "FF111111" } };
  r2.alignment = { vertical: "middle", horizontal: "left" };
  r2.height = 18;
  const r3 = ws.getRow(3);
  r3.font = { italic: true, size: 9, color: { argb: "FF444444" } };
  r3.alignment = { vertical: "middle", horizontal: "left" };
  r3.height = 14;
}

function styleHeader(ws: ExcelJS.Worksheet, colCount: number, rowIdx = 1) {
  const row = ws.getRow(rowIdx);
  row.height = 20;
  for (let i = 1; i <= colCount; i++) {
    const c = row.getCell(i);
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    c.alignment = { vertical: "middle", horizontal: "left" };
    c.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
  }
  row.commit();
}

function zebra(ws: ExcelJS.Worksheet, from: number, to: number, cols: number) {
  for (let r = from; r <= to; r++) {
    if ((r - from) % 2 === 1) {
      for (let i = 1; i <= cols; i++) {
        ws.getRow(r).getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
    }
  }
}

function borders(ws: ExcelJS.Worksheet, from: number, to: number, cols: number) {
  const edge = { style: "hair" as const, color: { argb: "FFB8BEC7" } };
  for (let r = from; r <= to; r++) {
    for (let i = 1; i <= cols; i++) {
      ws.getRow(r).getCell(i).border = { top: edge, left: edge, bottom: edge, right: edge };
    }
  }
}

function fmtTime(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// GET /api/export/xlsx?date=YYYY-MM-DD&tz=Africa/Lagos — styled multi-sheet Excel workbook of the day,
// every sheet headed like the printed controlled form (company · report title · document ref).
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const dateParam = req.nextUrl.searchParams.get("date");
  const tz = req.nextUrl.searchParams.get("tz");
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  }
  const { start, end, dateStr } = zonedDayBounds(dateParam, tz);
  const org = await readOrg();
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz || undefined }).format(new Date());
  const dateLong = new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const docLine = `Document Ref: IB-ENG-DR-001 · Rev 02 · Classification: Internal Use · Printed by ${user.name} on ${when}`;
  const sheetTitle = (section: string) => `Daily Machine Status & Maintenance Report · ${section} · Report date ${dateLong}`;

  const logs = await db.statusLog.findMany({
    where: { createdAt: { gte: start, lte: end } },
    include: { user: true, component: { include: { machine: { include: { department: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const wos = await db.workOrder.findMany({
    where: { OR: [{ createdAt: { gte: start, lte: end } }, { completedAt: { gte: start, lte: end } }] },
    include: { machine: true, assignedTo: true },
    orderBy: { code: "asc" },
  });
  const dts = await db.downtime.findMany({
    where: { startedAt: { lte: end }, OR: [{ endedAt: null }, { endedAt: { gte: start } }] },
    include: { machine: true, reportedBy: true },
    orderBy: { startedAt: "desc" },
  });
  const parts = await db.part.findMany({ orderBy: { code: "asc" } });

  const wb = new ExcelJS.Workbook();
  wb.creator = "BrewOps · Digital Work Order & PM System";
  wb.created = new Date();

  // ---- Sheet 0: Daily Summary (first tab) ----
  const ws0 = wb.addWorksheet("Daily Summary", { views: [{ state: "frozen", ySplit: 1 + TITLE_ROWS }] });
  ws0.columns = [
    { header: "Metric", key: "k", width: 34 },
    { header: "Value", key: "v", width: 30 },
  ];

  // ---- Sheet 1: Status Round ----
  const ws1 = wb.addWorksheet("Status Round", { views: [{ state: "frozen", ySplit: 1 + TITLE_ROWS }] });
  ws1.columns = [
    { header: "Time", key: "time", width: 11 },
    { header: "Department", key: "dept", width: 14 },
    { header: "Machine Code", key: "mcode", width: 14 },
    { header: "Machine", key: "mname", width: 26 },
    { header: "Component", key: "comp", width: 28 },
    { header: "Part No", key: "part", width: 12 },
    { header: "Category", key: "cat", width: 12 },
    { header: "Status", key: "status", width: 16 },
    { header: "Note", key: "note", width: 52 },
    { header: "Reported By", key: "by", width: 16 },
  ];
  for (const l of logs) {
    const row = ws1.addRow({
      time: l.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      dept: l.component.machine.department.name,
      mcode: l.component.machine.code,
      mname: l.component.machine.name,
      comp: l.component.name,
      part: l.component.partCode ?? "",
      cat: l.component.category ?? "",
      status: STATUS_META[l.status as keyof typeof STATUS_META]?.label ?? l.status,
      note: l.note ?? "",
      by: l.user.name,
    });
    const status = l.status;
    const fill = status === "WORKING" || status === "STANDBY" ? OK_FILL
      : status === "BROKEN" || status === "LOTO" || status === "BYPASS" || status === "SIMULATION" ? BAD_FILL : WARN_FILL;
    row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    row.getCell("status").font = { bold: true, size: 10 };
    row.getCell("time").numFmt = "hh:mm";
  }
  addTitleBlock(ws1, 10, org.name, sheetTitle("Status Round"), docLine);
  styleHeader(ws1, 10, 1 + TITLE_ROWS);
  borders(ws1, 2 + TITLE_ROWS, ws1.rowCount, 10);
  zebra(ws1, 2 + TITLE_ROWS, ws1.rowCount, 10);
  ws1.autoFilter = { from: { row: 1 + TITLE_ROWS, column: 1 }, to: { row: 1 + TITLE_ROWS, column: 10 } };

  // ---- Sheet 2: Downtime ----
  const ws2 = wb.addWorksheet("Downtime", { views: [{ state: "frozen", ySplit: 1 + TITLE_ROWS }] });
  ws2.columns = [
    { header: "Machine Code", key: "mcode", width: 14 },
    { header: "Machine", key: "mname", width: 26 },
    { header: "Reason", key: "reason", width: 56 },
    { header: "Started", key: "start", width: 18 },
    { header: "Ended", key: "end", width: 18 },
    { header: "Lost Minutes", key: "mins", width: 13 },
    { header: "State", key: "state", width: 10 },
    { header: "Reported By", key: "by", width: 16 },
  ];
  for (const d of dts) {
    const s = Math.max(d.startedAt.getTime(), start.getTime());
    const e = d.endedAt ? Math.min(d.endedAt.getTime(), end.getTime()) : end.getTime();
    const row = ws2.addRow({
      mcode: d.machine.code, mname: d.machine.name, reason: d.reason,
      start: fmtTime(d.startedAt), end: d.endedAt ? fmtTime(d.endedAt) : "",
      mins: Math.max(1, Math.round((e - s) / 60000)),
      state: d.endedAt ? "Closed" : "OPEN",
      by: d.reportedBy.name,
    });
    if (!d.endedAt) row.getCell("state").font = { bold: true, color: { argb: "FFDC2626" } };
  }
  addTitleBlock(ws2, 8, org.name, sheetTitle("Downtime"), docLine);
  styleHeader(ws2, 8, 1 + TITLE_ROWS);
  borders(ws2, 2 + TITLE_ROWS, ws2.rowCount, 8);
  zebra(ws2, 2 + TITLE_ROWS, ws2.rowCount, 8);
  ws2.autoFilter = { from: { row: 1 + TITLE_ROWS, column: 1 }, to: { row: 1 + TITLE_ROWS, column: 8 } };

  // ---- Sheet 3: Work Orders ----
  const ws3 = wb.addWorksheet("Work Orders", { views: [{ state: "frozen", ySplit: 1 + TITLE_ROWS }] });
  ws3.columns = [
    { header: "WO No", key: "code", width: 11 },
    { header: "Title", key: "title", width: 44 },
    { header: "Machine", key: "mcode", width: 14 },
    { header: "Type", key: "type", width: 12 },
    { header: "Priority", key: "prio", width: 10 },
    { header: "Status", key: "status", width: 13 },
    { header: "Assigned To", key: "assign", width: 16 },
    { header: "Due", key: "due", width: 18 },
    { header: "Completed", key: "done", width: 18 },
  ];
  for (const w of wos) {
    const row = ws3.addRow({
      code: w.code, title: w.title, mcode: w.machine.code,
      type: w.type === "PM" ? "PM" : "Corrective",
      prio: w.priority, status: w.status.replace(/_/g, " "),
      assign: w.assignedTo?.name ?? "",
      due: fmtTime(w.dueDate), done: w.completedAt ? fmtTime(w.completedAt) : "",
    });
    if (w.status === "COMPLETED") row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: OK_FILL } };
    if (w.priority === "URGENT") row.getCell("prio").fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAD_FILL } };
  }
  addTitleBlock(ws3, 9, org.name, sheetTitle("Work Orders"), docLine);
  styleHeader(ws3, 9, 1 + TITLE_ROWS);
  borders(ws3, 2 + TITLE_ROWS, ws3.rowCount, 9);
  zebra(ws3, 2 + TITLE_ROWS, ws3.rowCount, 9);
  ws3.autoFilter = { from: { row: 1 + TITLE_ROWS, column: 1 }, to: { row: 1 + TITLE_ROWS, column: 9 } };

  // ---- Sheet 4: Spares Stock ----
  const ws4 = wb.addWorksheet("Spares Stock", { views: [{ state: "frozen", ySplit: 1 + TITLE_ROWS }] });
  ws4.columns = [
    { header: "Part Code", key: "code", width: 13 },
    { header: "Part", key: "name", width: 30 },
    { header: "In Store", key: "stock", width: 10 },
    { header: "Reorder At", key: "reorder", width: 12 },
    { header: "Stock State", key: "state", width: 12 },
  ];
  for (const p of parts) {
    const state = p.stock === 0 ? "OUT" : p.stock <= p.reorderLevel ? "LOW" : "OK";
    const row = ws4.addRow({ code: p.code, name: p.name, stock: p.stock, reorder: p.reorderLevel, state });
    const cell = row.getCell("state");
    if (state === "OUT") { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAD_FILL } }; cell.font = { bold: true, size: 10, color: { argb: "FFDC2626" } }; }
    else if (state === "LOW") { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARN_FILL } }; cell.font = { bold: true, size: 10, color: { argb: "FFC2410C" } }; }
  }
  addTitleBlock(ws4, 5, org.name, sheetTitle("Spares Stock"), docLine);
  styleHeader(ws4, 5, 1 + TITLE_ROWS);
  borders(ws4, 2 + TITLE_ROWS, ws4.rowCount, 5);
  zebra(ws4, 2 + TITLE_ROWS, ws4.rowCount, 5);
  ws4.autoFilter = { from: { row: 1 + TITLE_ROWS, column: 1 }, to: { row: 1 + TITLE_ROWS, column: 5 } };

  // populate summary (sheet already first in tab order)
  const statusCounts: Record<string, number> = {};
  for (const l of logs) statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1;
  ws0.addRow({ k: "Report date", v: dateLong });
  ws0.addRow({ k: "Company", v: org.name });
  ws0.addRow({ k: "Printed by", v: `${user.name} · ${when}` });
  ws0.addRow({ k: "Document", v: "IB-ENG-DR-001 · Rev 02 · Internal Use" });
  ws0.addRow({ k: "" , v: "" });
  ws0.addRow({ k: "Status entries logged", v: logs.length });
  ws0.addRow({ k: "Downtime episodes", v: dts.length });
  ws0.addRow({ k: "Work orders touched", v: wos.length });
  ws0.addRow({ k: "Spares below reorder", v: parts.filter((p) => p.stock <= p.reorderLevel).length });
  ws0.addRow({ k: "" , v: "" });
  ws0.addRow({ k: "Status breakdown", v: "" });
  for (const [s, n] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    ws0.addRow({ k: `  ${STATUS_META[s as keyof typeof STATUS_META]?.label ?? s}`, v: n });
  }
  addTitleBlock(ws0, 2, org.name, sheetTitle("Daily Summary"), docLine);
  styleHeader(ws0, 2, 1 + TITLE_ROWS);
  borders(ws0, 2 + TITLE_ROWS, ws0.rowCount, 2);
  ws0.getRow(2 + TITLE_ROWS).font = { bold: true, size: 11 };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="brewops-report-${dateStr}.xlsx"`,
    },
  });
}

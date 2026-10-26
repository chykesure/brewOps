"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDayReport, CLIENT_TZ } from "@/lib/client-api";
import { localDateStr, STATUS_META } from "@/lib/status";
import type { BootstrapData, DayReport, Status } from "@/lib/types";
import { StatusBadge } from "@/components/brewops/status-badge";
import { ExcelGrid, type SheetSpec } from "@/components/brewops/excel-grid";
import DailyReportDocument from "@/components/brewops/daily-report-document";
import { toast } from "sonner";
import {
  ChevronLeft, ChevronRight, Download, Printer, LoaderCircle,
  Table2, ScrollText,
} from "lucide-react";

type Mode = "grid" | "document";

function hm(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
export default function ReportsView({ data }: { data?: BootstrapData }) {
  const [date, setDate] = useState(localDateStr());
  const [report, setReport] = useState<DayReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("grid");
  const org = data?.org ?? { name: "INTERNATIONAL BREWERIES PLC.", logoUrl: null, branches: [] };

  const load = useCallback(async (d: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      setReport(await fetchDayReport(d, CLIENT_TZ));
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Could not load report");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date); }, [date, load]);

  // Live feed: the app-controller silently refreshes the bootstrap whenever the
  // plant's data moves; the day report must follow, or the Reports tab would show
  // yesterday's picture on a page the engineer keeps open all shift.
  const firstData = useRef(true);
  useEffect(() => {
    if (firstData.current) {
      firstData.current = false;
      return;
    }
    if (data) void load(date, true);
  }, [data, date, load]);

  const shiftDate = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(localDateStr(d));
  };

  // ---- build Excel-style sheets from the compiled report ----
  const sheets: SheetSpec[] = useMemo(() => {
    if (!report) return [];
    const logRows = report.machines.flatMap((m) =>
      m.logs.map((l) => ({
        time: hm(l.createdAt), dept: m.departmentName ?? "", mcode: m.code, mname: m.name,
        comp: l.componentName, part: l.componentPartCode ?? "", cat: l.componentCategory ?? "",
        status: STATUS_META[l.status as Status]?.label ?? l.status, rawStatus: l.status,
        note: l.note ?? "", by: l.userName,
      })).sort((a, b) => a.time.localeCompare(b.time)),
    );
    const dtRows = (report.downtimes ?? []).map((d) => ({
      mcode: d.machineCode, mname: d.machineName, reason: d.reason,
      start: hm(d.startedAt), end: d.endedAt ? hm(d.endedAt) : "",
      mins: d.minutes ?? 0, state: d.open ? "OPEN" : "Closed", by: d.reportedBy,
    }));
    const woRows = report.workOrders.map((w) => ({
      code: w.code, title: w.title, m: w.machine,
      type: w.type === "PM" ? "PM" : "Corrective", prio: w.priority ?? "NORMAL",
      status: w.status.replace(/_/g, " "), by: w.assignedTo ?? "",
      due: w.dueDate ? hm(w.dueDate) : "", done: w.completedAt ? hm(w.completedAt) : "",
    }));
    const spRows = (report.spares ?? []).map((p) => ({
      code: p.code, name: p.name, stock: p.stock, reorder: p.reorderLevel,
      state: p.stock === 0 ? "OUT" : p.stock <= p.reorderLevel ? "LOW" : "OK",
    }));

    return [
      {
        id: "log", name: "Status Log",
        cols: [
          { key: "time", label: "Time", w: "w-[70px]", mono: true },
          { key: "dept", label: "Department", w: "w-[100px]" },
          { key: "mcode", label: "Machine Code", w: "w-[110px]", mono: true },
          { key: "mname", label: "Machine" },
          { key: "comp", label: "Component" },
          { key: "part", label: "Part No", w: "w-[90px]", mono: true },
          { key: "cat", label: "Category", w: "w-[95px]" },
          { key: "status", label: "Status", w: "w-[120px]" },
          { key: "note", label: "Note" },
          { key: "by", label: "Reported By", w: "w-[110px]" },
        ],
        rows: logRows,
        render: (k, row) =>
          k === "status" ? <StatusBadge status={row.rawStatus as Status} size="xs" /> : String(row[k] ?? ""),
        totalLabel: "status entries", totalValue: String(logRows.length),
      },
      {
        id: "dt", name: "Downtime",
        cols: [
          { key: "mcode", label: "Machine Code", w: "w-[110px]", mono: true },
          { key: "mname", label: "Machine" },
          { key: "reason", label: "Reason" },
          { key: "start", label: "Started", w: "w-[70px]", mono: true },
          { key: "end", label: "Ended", w: "w-[70px]", mono: true },
          { key: "mins", label: "Lost min", w: "w-[80px]", mono: true },
          { key: "state", label: "State", w: "w-[80px]" },
          { key: "by", label: "Reported By", w: "w-[110px]" },
        ],
        rows: dtRows,
        render: (k, row) =>
          k === "state" ? (
            <span className={row.state === "OPEN" ? "text-red-400 font-bold animate-pulse" : ""}>{row.state}</span>
          ) : String(row[k] ?? ""),
        totalLabel: "lost minutes", totalValue: String(dtRows.reduce((a, b) => a + Number(b.mins), 0)),
      },
      {
        id: "wo", name: "Work Orders",
        cols: [
          { key: "code", label: "WO No", w: "w-[80px]", mono: true },
          { key: "title", label: "Title" },
          { key: "m", label: "Machine", w: "w-[100px]", mono: true },
          { key: "type", label: "Type", w: "w-[90px]" },
          { key: "prio", label: "Priority", w: "w-[85px]" },
          { key: "status", label: "Status", w: "w-[110px]" },
          { key: "by", label: "Assigned To", w: "w-[110px]" },
          { key: "due", label: "Due", w: "w-[70px]", mono: true },
          { key: "done", label: "Completed", w: "w-[85px]", mono: true },
        ],
        rows: woRows,
        render: (k, row) =>
          k === "prio" ? (
            <span className={row.prio === "URGENT" ? "text-red-400 font-bold" : row.prio === "HIGH" ? "text-amber-300" : ""}>{row.prio}</span>
          ) : String(row[k] ?? ""),
        totalLabel: "work orders", totalValue: String(woRows.length),
      },
      {
        id: "sp", name: "Spares",
        cols: [
          { key: "code", label: "Part Code", w: "w-[110px]", mono: true },
          { key: "name", label: "Part" },
          { key: "stock", label: "In Store", w: "w-[80px]", mono: true },
          { key: "reorder", label: "Reorder At", w: "w-[90px]", mono: true },
          { key: "state", label: "State", w: "w-[80px]" },
        ],
        rows: spRows,
        render: (k, row) =>
          k === "state" ? (
            <span className={row.state === "OUT" ? "text-red-400 font-bold" : row.state === "LOW" ? "text-amber-300 font-bold" : "text-emerald-400"}>{row.state}</span>
          ) : String(row[k] ?? ""),
        totalLabel: "parts tracked", totalValue: String(spRows.length),
      },
    ];
  }, [report]);

  const dateLong = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="p-4 md:p-6 md:max-w-6xl space-y-3">
      {/* Controls */}
      <div className="print-hide space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Daily Report</h1>
            <p className="text-xs text-muted-foreground">Auto-compiled from the floor. Preview it like a spreadsheet, export it like Excel.</p>
          </div>
          <div className="flex rounded-xl border border-border bg-card p-1" role="group" aria-label="Report view mode">
            <button
              onClick={() => setMode("grid")}
              className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${mode === "grid" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={mode === "grid"}
            >
              <Table2 className="h-3.5 w-3.5" /> Grid
            </button>
            <button
              onClick={() => setMode("document")}
              className={`h-8 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${mode === "document" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              aria-pressed={mode === "document"}
            >
              <ScrollText className="h-3.5 w-3.5" /> Document preview
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <button onClick={() => shiftDate(-1)} className="h-10 w-10 rounded-xl bg-card border border-border flex items-center justify-center hover:bg-accent" aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={date}
              max={localDateStr()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-10 rounded-xl bg-card border border-border px-3 text-sm text-center font-semibold outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={() => shiftDate(1)}
              disabled={date >= localDateStr()}
              className="h-10 w-10 rounded-xl bg-card border border-border flex items-center justify-center hover:bg-accent disabled:opacity-30"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1" />
          <a
            href={`/api/export/xlsx?date=${date}${CLIENT_TZ ? `&tz=${encodeURIComponent(CLIENT_TZ)}` : ""}`}
            className="h-10 px-4 rounded-xl bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <Download className="h-4 w-4" /> Export Excel (.xlsx)
          </a>
          <a
            href={`/api/export?date=${date}${CLIENT_TZ ? `&tz=${encodeURIComponent(CLIENT_TZ)}` : ""}`}
            className="h-10 px-4 rounded-xl bg-secondary border border-border text-xs font-bold flex items-center justify-center gap-2 hover:bg-accent transition-colors"
          >
            <Download className="h-4 w-4" /> CSV
          </a>
          <button
            onClick={() => {
              setMode("document");
              setTimeout(() => window.print(), 120);
            }}
            className="h-10 px-4 rounded-xl bg-secondary border border-border text-xs font-bold flex items-center justify-center gap-2 hover:bg-accent transition-colors"
          >
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
        </div>
      </div>

      {loading && !report ? (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-16">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Compiling report…
        </p>
      ) : !report ? (
        <p className="text-xs text-muted-foreground text-center py-16">No data.</p>
      ) : (
        <>
          {/* Spreadsheet view — screen only; printing ALWAYS produces the paper document below,
              whether the engineer is looking at the grid or the document preview */}
          <div className={`print-hide ${mode === "grid" ? "" : "hidden"}`}>
          {/* KPI line */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
            <span><b className="text-foreground font-mono">{report.totalLogs}</b> status entries</span>
            <span><b className="text-foreground font-mono">{report.totalComponents}</b> components registered</span>
            <span><b className="text-foreground font-mono">{report.downtimes?.length ?? 0}</b> downtime episodes</span>
            <span><b className="text-foreground font-mono">{report.workOrders.length}</b> work orders touched</span>
            <span><b className="text-foreground font-mono">{(report.spares ?? []).filter((p) => p.stock <= p.reorderLevel).length}</b> spares low/out</span>
          </div>
          <ExcelGrid sheets={sheets} subtitle={`brewops-report-${date}.xlsx`} />
          <p className="text-[9px] text-muted-foreground text-center pb-2">
            Same data as the exported workbook. Filters here don&apos;t change the file. Every entry carries user &amp; timestamp.
          </p>
          </div>

          {/* ---------- Paper document — always mounted in .print-area, so Print/PDF and
               Ctrl+P both produce the formal controlled form no matter which mode is on screen ---------- */}
          <div className={`print-area ${mode === "document" ? "" : "hidden"}`}>
            <DailyReportDocument
              report={report}
              dateLong={dateLong}
              org={org}
              printedBy={data?.user?.name ?? "Engineering"}
            />
          </div>
        </>
      )}
    </div>
  );
}

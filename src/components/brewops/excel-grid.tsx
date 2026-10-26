"use client";

import { useMemo, useState } from "react";
import { Table2 } from "lucide-react";

export interface SheetSpec {
  id: string;
  name: string;
  cols: { key: string; label: string; w?: string; mono?: boolean }[];
  rows: Record<string, string | number>[];
  /** optional custom cell renderer per column key */
  render?: (key: string, row: Record<string, string | number>) => React.ReactNode;
  totalLabel?: string;
  totalValue?: string;
}

function colLetter(i: number): string {
  let s = "";
  let n = i;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

export function ExcelGrid({ sheets, subtitle }: { sheets: SheetSpec[]; subtitle: string }) {
  const [sheetId, setSheetId] = useState(sheets[0]?.id ?? "");
  const [filters, setFilters] = useState<Record<string, Record<string, string>>>({});
  const sheet = sheets.find((s) => s.id === sheetId) ?? sheets[0];

  const filtered = useMemo(() => {
    if (!sheet) return [];
    const f = filters[sheet.id] ?? {};
    const keys = Object.keys(f).filter((k) => f[k]?.trim());
    if (keys.length === 0) return sheet.rows;
    return sheet.rows.filter((row) =>
      keys.every((k) => String(row[k] ?? "").toLowerCase().includes(f[k].trim().toLowerCase())),
    );
  }, [sheet, filters]);

  if (!sheet) return null;

  const setFilter = (colKey: string, v: string) =>
    setFilters((prev) => ({ ...prev, [sheet.id]: { ...(prev[sheet.id] ?? {}), [colKey]: v } }));
  const f = filters[sheet.id] ?? {};
  const isFiltered = Object.values(f).some((v) => v?.trim());

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden print-hide">
      {/* window title bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-secondary/40">
        <p className="text-[11px] font-mono text-muted-foreground truncate">
          <Table2 className="h-3 w-3 inline mr-1.5 -mt-0.5" />
          {subtitle} · [{sheet.name}]
        </p>
        <p className="text-[10px] font-mono text-muted-foreground shrink-0">
          {isFiltered ? `${filtered.length} of ${sheet.rows.length}` : sheet.rows.length} rows
        </p>
      </div>

      {/* sheet tabs */}
      <div className="flex items-end gap-0.5 px-2 pt-1.5 border-b border-border bg-secondary/20 overflow-x-auto brewops-scroll">
        {sheets.map((s) => (
          <button
            key={s.id}
            onClick={() => setSheetId(s.id)}
            className={`whitespace-nowrap px-3 py-1.5 text-[11px] font-semibold rounded-t-lg border-t border-x transition-colors ${
              s.id === sheetId
                ? "bg-card border-border text-primary -mb-px border-b-card"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={s.id === sheetId}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* the grid */}
      <div className="overflow-x-auto brewops-scroll">
        <table className="w-full border-collapse text-[11px]" style={{ minWidth: sheet.cols.length * 110 }}>
          <thead className="sticky top-0 z-10">
            {/* column letters */}
            <tr className="bg-secondary/70">
              <th className="w-9 border-r border-b border-border text-[9px] text-muted-foreground font-mono font-normal">◈</th>
              {sheet.cols.map((c, i) => (
                <th key={c.key} className={`border-r border-b border-border text-[9px] font-mono font-bold text-muted-foreground text-center py-0.5 ${c.w ?? ""}`}>
                  {colLetter(i)}
                </th>
              ))}
            </tr>
            {/* real headers */}
            <tr className="bg-secondary/90">
              <th className="w-9 border-r border-b border-border text-[9px] text-muted-foreground font-normal">#</th>
              {sheet.cols.map((c) => (
                <th key={c.key} className="border-r border-b border-border px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
            {/* filter row */}
            <tr className="bg-card">
              <th className="border-r border-b border-border text-center text-[9px] text-muted-foreground font-normal">▽</th>
              {sheet.cols.map((c) => (
                <th key={c.key} className="border-r border-b border-border p-0.5">
                  <input
                    value={f[c.key] ?? ""}
                    onChange={(e) => setFilter(c.key, e.target.value)}
                    placeholder="filter…"
                    aria-label={`Filter ${c.label}`}
                    className="w-full min-w-[64px] bg-background/60 rounded px-1.5 py-0.5 text-[10px] font-normal outline-none focus:ring-1 focus:ring-primary/60 border border-border/60"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={sheet.cols.length + 1} className="text-center text-muted-foreground py-10">
                  {sheet.rows.length === 0 ? "No records for this day." : "No rows match the filters."}
                </td>
              </tr>
            )}
            {filtered.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 1 ? "bg-secondary/25" : ""}>
                <td className="border-r border-b border-border/50 text-center text-[9px] font-mono text-muted-foreground bg-secondary/40">{ri + 1}</td>
                {sheet.cols.map((c) => (
                  <td key={c.key} className={`border-r border-b border-border/50 px-2 py-1.5 align-middle whitespace-nowrap ${c.mono ? "font-mono tabular-nums" : ""}`}>
                    {sheet.render ? sheet.render(c.key, row) : String(row[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {sheet.totalValue && (
            <tfoot>
              <tr className="bg-secondary/80 font-bold">
                <td className="border-r border-t border-border" />
                <td colSpan={Math.max(1, sheet.cols.length - 1)} className="border-r border-t border-border px-2 py-1.5 text-[10px] uppercase tracking-wide">
                  Σ {sheet.totalLabel}
                </td>
                <td className="border-r border-t border-border px-2 py-1.5 font-mono tabular-nums text-right">{sheet.totalValue}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

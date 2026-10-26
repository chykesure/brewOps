"use client";

// MachineStatusReport — a machine's component status log rendered as the plant's
// paper report (company letterhead with the uploaded logo, status counts, and the
// full timestamped log with reporter attribution). Print → clean A4 via the same
// portal pattern the WO report uses, so the print stylesheet hides the whole app.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fetchStatusReport, CLIENT_TZ } from "@/lib/client-api";
import type { StatusReportData } from "@/lib/types";
import { STATUS_META } from "@/lib/status";
import { X, Printer, LoaderCircle } from "lucide-react";

function fmtD(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDT(iso: string): string {
  const d = new Date(iso);
  return `${fmtD(iso)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function OrgLogo({ org, size, className }: { org: { name: string; logoUrl: string | null }; size?: number; className?: string }) {
  if (org.logoUrl) {
     
    return (
      <img
        src={org.logoUrl}
        alt={`${org.name} logo`}
        style={size ? { height: size, width: "auto" } : undefined}
        className={className ?? "h-16 w-auto max-w-[190px] shrink-0 object-contain sm:h-24 sm:max-w-[240px]"}
      />
    );
  }
  return (
    <svg
      viewBox="0 0 40 40"
      style={size ? { height: size, width: size } : undefined}
      className={className ?? "h-16 w-16 shrink-0 sm:h-24 sm:w-24"}
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="19" fill="none" stroke="#111" strokeWidth="1.6" />
      <path d="M20 6 C13 14 11 22 20 34 C29 22 27 14 20 6 Z" fill="none" stroke="#111" strokeWidth="1.6" />
      <path d="M20 10 L20 30 M20 16 L14.5 12.5 M20 16 L25.5 12.5 M20 23 L14 19 M20 23 L26 19" stroke="#111" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

export function OrgLetterhead({ org, center, right }: { org: StatusReportData["org"]; center?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 border-b-2 border-[#111] pb-3 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-x-4 sm:text-left">
      {/* The uploaded logo carries the company name, so it stands alone; text block only when no logo is on file */}
      <div className="flex min-w-0 items-center gap-2.5">
        <OrgLogo org={org} />
        {!org.logoUrl && (
          <div className="min-w-0">
            <p className="text-[13px] font-black leading-tight tracking-tight sm:text-[15px]">{org.name}</p>
            <p className="mt-0.5 text-[8px] italic text-[#444] sm:text-[9px]">Digital Work Order &amp; PM System · BrewOps</p>
          </div>
        )}
      </div>
      {center && <div className="min-w-0 flex-1 sm:px-2">{center}</div>}
      {right}
    </div>
  );
}

export default function MachineStatusReport({
  machineId,
  machineCode,
  onClose,
}: {
  machineId: string;
  machineCode: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<StatusReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86400_000);
    const f = (d: Date) => d.toISOString().slice(0, 10);
    fetchStatusReport(machineId, f(from), f(to), CLIENT_TZ)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the report"));
  }, [machineId]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="wo-print-root fixed inset-0 z-[60] overflow-y-auto bg-black/80 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="wo-print-toolbar sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-[#17140f]/95 px-4 py-2.5 backdrop-blur">
        <p className="text-xs font-semibold text-white/90">
          Status Log Report <span className="font-mono text-white/50">{machineCode}</span>
          <span className="ml-2 hidden text-[10px] text-white/40 sm:inline">last 7 days · machine status history</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            disabled={!data}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-[#111] hover:bg-white/90 disabled:opacity-50"
          >
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
          <button
            onClick={onClose}
            aria-label="Close report"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 text-white/80 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Paper */}
      <div className="wo-paper mx-auto my-4 w-[calc(100%-2rem)] max-w-[860px] rounded-md bg-white p-4 text-[#111] shadow-2xl sm:my-6 sm:p-9 print:m-0 print:w-full print:max-w-none print:rounded-none print:p-6 print:shadow-none">
        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        {!data && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#666]">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Compiling the status log…
          </div>
        )}
        {data && (
          <>
            {/* ── Letterhead ── */}
            <OrgLetterhead
              org={data.org}
              center={
                <div className="text-center">
                  <h1 className="text-xl font-black tracking-wide sm:text-2xl">MACHINE STATUS LOG REPORT</h1>
                  <p className="mt-0.5 text-[11px] font-semibold text-[#333] sm:text-xs">Maintenance status history · reported from the floor</p>
                  {/* Document control strip — same controlled-form grammar as the WO report letterhead */}
                  <div className="mt-1.5 border-t border-dotted border-[#777] pt-1 text-[9px] leading-[1.6] text-[#222]">
                    <p>
                      <span className="font-bold">Document Ref.:</span> <span className="font-mono">IB-ENG-SL-001</span>
                      <span className="mx-1 text-[#999]">·</span>
                      <span className="font-bold">Revision:</span> <span className="font-mono">02</span>
                    </p>
                    <p>
                      <span className="font-bold">Classification:</span> Internal Use <span className="mx-1 text-[#999]">·</span> <span className="font-bold">Copy:</span> Original
                    </p>
                    <p className="italic text-[#555]">Printed copies are uncontrolled unless stamped.</p>
                  </div>
                </div>
              }
              right={
                <table className="w-[168px] max-w-full shrink-0 border-collapse text-[10px] sm:text-[11px]">
                  <tbody>
                    {[
                      ["Machine", data.machine.code],
                      ["From", fmtD(data.from)],
                      ["To", fmtD(data.to)],
                      ["Entries", String(data.summary.total)],
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td className="border border-[#888] px-1.5 py-[3px] text-right font-semibold text-[#333]">{k}</td>
                        <td className="border border-[#888] px-1.5 py-[3px] text-center font-mono">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />

            <p className="mt-3 text-center text-[11px] font-semibold text-[#333] sm:text-[12px]">
              {data.machine.code} · {data.machine.name} · {data.machine.departmentName}
              {data.machine.location ? ` · ${data.machine.location}` : ""}
            </p>

            {/* ── Machine identity block ── */}
            <div className="mt-3 border-2 border-[#111] px-3 py-2 text-[11px]">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <p><span className="font-bold">Functional Loc.:</span> <span className="font-mono">{data.machine.functionalLoc ?? "n/a"}</span></p>
                <p><span className="font-bold">Equipment:</span> <span className="font-mono">{data.machine.equipmentNo || "n/a"}</span></p>
                <p><span className="font-bold">Components:</span> {data.machine.componentCount}</p>
                <p><span className="font-bold">Assigned Artisan:</span> {data.machine.ownerName ?? "Unassigned"}</p>
              </div>
            </div>

            {/* ── Summary block ── */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <p><span className="font-bold">Total entries:</span> {data.summary.total}</p>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-bold">By state:</span>
                {Object.entries(data.summary.byStatus).sort((a, b) => b[1] - a[1]).map(([st, n]) => (
                  <span key={st} className="whitespace-nowrap">{STATUS_META[st as keyof typeof STATUS_META]?.label ?? st}: <b>{n}</b></span>
                ))}
                {data.summary.total === 0 && <span className="italic text-[#666]">no entries in this window</span>}
              </p>
              {data.summary.reporters.length > 0 && (
                <p><span className="font-bold">Reported by:</span> {data.summary.reporters.join(", ")}</p>
              )}
            </div>

            {/* ── Log table ── */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[10.5px]">
              <thead>
                <tr className="bg-[#f0f0f0]">
                  {["When", "Component", "Part", "State", "Note / observation", "By", "GPS"].map((h) => (
                    <th key={h} className="border border-[#888] px-1.5 py-1 text-left font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="border border-[#888] px-2 py-6 text-center italic text-[#666]">
                      No status entries for this machine between {fmtD(data.from)} and {fmtD(data.to)}.
                    </td>
                  </tr>
                ) : (
                  data.logs.map((l) => (
                    <tr key={l.id} className="align-top">
                      <td className="border border-[#888] px-1.5 py-1 font-mono whitespace-nowrap">{fmtDT(l.createdAt)}</td>
                      <td className="border border-[#888] px-1.5 py-1">{l.componentName}</td>
                      <td className="border border-[#888] px-1.5 py-1 font-mono">{l.partCode ?? ""}</td>
                      <td className="border border-[#888] px-1.5 py-1 font-semibold whitespace-nowrap">{STATUS_META[l.status]?.label ?? l.status}</td>
                      <td className="border border-[#888] px-1.5 py-1">{l.note ?? ""}</td>
                      <td className="border border-[#888] px-1.5 py-1 whitespace-nowrap">{l.userName}</td>
                      <td className="border border-[#888] px-1.5 py-1 font-mono whitespace-nowrap">{l.distanceM != null ? `${Math.round(l.distanceM)} m` : ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-end justify-between text-[9px] text-[#555]">
              <p>
                Generated from the live system record · printed {fmtDT(new Date().toISOString())}.<br />
                Printed copies are uncontrolled. The system record is authoritative.
              </p>
              <p className="text-right">
                Verified by (Engineer): ______________________<br />
                Date: ______________________
              </p>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

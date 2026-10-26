"use client";

// DailyReportDocument — the compiled day report rendered as the plant's formal paper
// ("DAILY MACHINE STATUS & MAINTENANCE REPORT"): the same controlled-form grammar as the
// WO paper (logo masthead, document-control strip, meta table, safety preamble, numbered
// sections with bordered tables, signature footer). Print → clean A4. Always mounted in
// .print-area by reports-view, so Print/PDF and Ctrl+P both emit this document.

import { OrgLogo } from "./machine-status-report";
import type { DayReport, Status } from "@/lib/types";
import { STATUS_META } from "@/lib/status";

const PRIORITY_SAP: Record<string, string> = {
  URGENT: "1-Very high",
  HIGH: "2-High",
  NORMAL: "3-Medium",
  LOW: "4-Low",
};

function hm(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function fmtD(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtMins(m: number) {
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function SectionTitle({ n, title, count }: { n: number; title: string; count?: string }) {
  return (
    <div className="mt-4 flex items-baseline justify-between gap-2 border-b-2 border-[#111] pb-1">
      <h2 className="text-[12px] font-black uppercase tracking-wide sm:text-[13px]">
        Section {n} · {title}
      </h2>
      {count ? <span className="text-[9.5px] font-semibold text-[#444]">{count}</span> : null}
    </div>
  );
}

const TH = "border border-[#888] bg-[#eee] px-1.5 py-[3px] text-left text-[8.5px] font-bold uppercase tracking-wide text-[#111] sm:text-[9px]";
const TD = "border border-[#999] px-1.5 py-[3px] align-top text-[9px] leading-[1.45] sm:text-[9.5px]";

export default function DailyReportDocument({
  report,
  dateLong,
  org,
  printedBy,
}: {
  report: DayReport;
  dateLong: string;
  org: { name: string; logoUrl: string | null };
  printedBy: string;
}) {
  const now = new Date();
  const printedOn = fmtD(now.toISOString());
  const logs = report.machines
    .flatMap((m) => m.logs.map((l) => ({ ...l, machine: m })))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const downtimes = report.downtimes ?? [];
  const lostTotal = downtimes.reduce((a, b) => a + (b.minutes ?? 0), 0);
  const spares = report.spares ?? [];
  const sparesLow = spares.filter((p) => p.stock <= p.reorderLevel);
  const departments = [...new Set(report.machines.map((m) => m.departmentName).filter(Boolean))] as string[];
  const gapMachines = report.machines.filter((m) => m.missing.length > 0);
  const covered = report.machines.filter((m) => m.missing.length === 0).length;

  const statusCounts = Object.entries(report.summary).sort((a, b) => b[1] - a[1]);

  return (
    <div className="wo-paper mx-auto my-4 w-[calc(100%-2rem)] max-w-[880px] rounded-md bg-white p-4 text-[#111] shadow-2xl sm:my-6 sm:p-9 print:m-0 print:w-full print:max-w-none print:rounded-none print:p-6 print:shadow-none">
      {/* ── Masthead — logo | title + document-control strip | meta table (same grammar as the WO paper) ── */}
      <div className="flex flex-col items-center gap-2 border-b-2 border-[#111] pb-3 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-x-4 sm:text-left">
        <OrgLogo org={org} />
        <div className="min-w-0 flex-1 sm:px-2">
          <h1 className="text-xl font-black leading-tight tracking-wide sm:text-[26px]">DAILY MACHINE STATUS</h1>
          <p className="text-sm font-black tracking-wide sm:text-[17px]">&amp; MAINTENANCE REPORT</p>
          <p className="mt-0.5 text-[11px] font-semibold italic sm:text-[12px]">Compiled from the floor · auto-generated, immutable source</p>
          {/* Document control strip */}
          <div className="mt-2 border-t border-dotted border-[#777] pt-1.5 text-[9px] leading-[1.7] text-[#222] sm:text-[9.5px]">
            <p>
              <span className="font-bold">Document Ref.:</span> <span className="font-mono">IB-ENG-DR-001</span>
              <span className="mx-1 text-[#999]">·</span>
              <span className="font-bold">Revision:</span> <span className="font-mono">02</span>
            </p>
            <p>
              <span className="font-bold">Issued By:</span> Engineering &amp; Maintenance Department
            </p>
            <p>
              <span className="font-bold">Classification:</span> Internal Use
              <span className="mx-1 text-[#999]">·</span>
              <span className="font-bold">Copy:</span> <span className="font-mono">Original</span>
            </p>
            <p className="italic text-[#555]">Printed copies are uncontrolled unless stamped.</p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5 sm:items-end">
          <table className="w-[190px] max-w-full border-collapse text-[10px] sm:text-[11px]">
            <tbody>
              {[
                ["Page", "1/1"],
                ["Report Date", report.date],
                ["Status Entries", String(report.totalLogs)],
                ["Printed On", printedOn],
                ["Printed By", printedBy],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="whitespace-nowrap border border-[#888] px-1.5 py-[3px] text-right font-semibold text-[#333]">{k}</td>
                  <td className="border border-[#888] px-1.5 py-[3px] text-center font-mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Safety preamble — same controlled text as the WO form */}
      <p className="mt-3 text-[10.5px] font-bold italic leading-snug text-[#222] sm:text-[11.5px]">
        Please note : Safety is your responsibility. Use Personal Protective Equipment, Follow all Lockout, Permit and
        Safety Instructions when applicable DO NOT proceed unless you have received basic safety induction training.
      </p>

      {/* ── Report summary box (SAP-style label:value header) ── */}
      <div className="mt-3 border-2 border-[#111] px-3 py-2 text-[10.5px] sm:text-[11.5px]">
        <p className="font-bold">Report Period: {dateLong}</p>
        <div className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <p className="flex flex-wrap gap-x-3">
            <span className="w-[136px] shrink-0 font-bold">Departments in scope:</span>
            <span>{departments.length > 0 ? departments.join(", ") : "n/a"}</span>
          </p>
          <p className="flex flex-wrap gap-x-3">
            <span className="w-[136px] shrink-0 font-bold">Machines covered:</span>
            <span className="font-mono">{report.machines.length}</span>
          </p>
          <p className="flex flex-wrap gap-x-3">
            <span className="w-[136px] shrink-0 font-bold">Components registered:</span>
            <span className="font-mono">{report.totalComponents}</span>
          </p>
          <p className="flex flex-wrap gap-x-3">
            <span className="w-[136px] shrink-0 font-bold">Downtime this day:</span>
            <span className="font-mono">
              {downtimes.length} episode{downtimes.length === 1 ? "" : "s"} · {fmtMins(lostTotal)} lost
            </span>
          </p>
          <p className="flex flex-wrap gap-x-3">
            <span className="w-[136px] shrink-0 font-bold">Work orders touched:</span>
            <span className="font-mono">{report.workOrders.length}</span>
          </p>
          <p className="flex flex-wrap gap-x-3">
            <span className="w-[136px] shrink-0 font-bold">Spares low / out:</span>
            <span className="font-mono">{sparesLow.length} of {spares.length} tracked</span>
          </p>
        </div>
        {/* Status breakdown */}
        <div className="mt-2 border-t border-dotted border-[#777] pt-1.5">
          <p className="text-[9.5px] font-bold uppercase tracking-wide text-[#333]">Status breakdown</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[9.5px] sm:text-[10px]">
            {statusCounts.length === 0 ? (
              <span className="font-sans italic text-[#555]">No statuses logged this day.</span>
            ) : (
              statusCounts.map(([s, n]) => (
                <span key={s}>
                  {STATUS_META[s as Status]?.label ?? s}: <b>{n}</b>
                </span>
              ))
            )}
          </p>
        </div>
      </div>

      {/* ── SECTION 1 · STATUS LOG ── */}
      <SectionTitle n={1} title="Status Log" count={`${logs.length} entr${logs.length === 1 ? "y" : "ies"}`} />
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[42px]`}>Time</th>
              <th className={TH}>Department</th>
              <th className={TH}>Machine</th>
              <th className={TH}>Component</th>
              <th className={`${TH} w-[70px]`}>Category</th>
              <th className={`${TH} w-[88px]`}>Status</th>
              <th className={TH}>Reported By</th>
              <th className={TH}>Note</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={8} className="border border-[#888] px-2 py-6 text-center italic text-[#666]">
                  No status entries were logged on this day.
                </td>
              </tr>
            )}
            {logs.map((l) => (
              <tr key={l.id} className="break-inside-avoid">
                <td className={`${TD} font-mono`}>{hm(l.createdAt)}</td>
                <td className={TD}>{l.machine.departmentName ?? "n/a"}</td>
                <td className={TD}>
                  <span className="font-mono font-semibold">{l.machine.code}</span> · {l.machine.name}
                </td>
                <td className={TD}>
                  {l.componentName}
                  {l.componentPartCode ? <span className="font-mono text-[#444]"> ({l.componentPartCode})</span> : null}
                </td>
                <td className={TD}>{l.componentCategory ?? "n/a"}</td>
                <td className={`${TD} font-semibold`}>{STATUS_META[l.status as Status]?.label ?? l.status}</td>
                <td className={TD}>{l.userName}</td>
                <td className={TD}>{l.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 2 · DOWNTIME ── */}
      <SectionTitle n={2} title="Downtime" count={`${downtimes.length} episode${downtimes.length === 1 ? "" : "s"} · ${fmtMins(lostTotal)} lost`} />
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className={TH}>Machine</th>
              <th className={TH}>Reason</th>
              <th className={`${TH} w-[52px]`}>Started</th>
              <th className={`${TH} w-[52px]`}>Ended</th>
              <th className={`${TH} w-[62px]`}>Lost</th>
              <th className={`${TH} w-[56px]`}>State</th>
              <th className={TH}>Reported By</th>
            </tr>
          </thead>
          <tbody>
            {downtimes.length === 0 && (
              <tr>
                <td colSpan={7} className="border border-[#888] px-2 py-4 text-center italic text-[#666]">
                  No downtime recorded this day.
                </td>
              </tr>
            )}
            {downtimes.map((d, i) => (
              <tr key={i} className="break-inside-avoid">
                <td className={TD}>
                  <span className="font-mono font-semibold">{d.machineCode}</span> · {d.machineName}
                </td>
                <td className={TD}>{d.reason}</td>
                <td className={`${TD} font-mono`}>{hm(d.startedAt)}</td>
                <td className={`${TD} font-mono`}>{d.endedAt ? hm(d.endedAt) : ""}</td>
                <td className={`${TD} font-mono`}>{d.open ? "running" : fmtMins(d.minutes ?? 0)}</td>
                <td className={`${TD} font-bold ${d.open ? "text-[#b91c1c]" : ""}`}>{d.open ? "OPEN" : "Closed"}</td>
                <td className={TD}>{d.reportedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 3 · WORK ORDERS ── */}
      <SectionTitle n={3} title="Work Orders" count={`${report.workOrders.length} touched`} />
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[74px]`}>WO No</th>
              <th className={TH}>Title</th>
              <th className={`${TH} w-[86px]`}>Machine</th>
              <th className={`${TH} w-[58px]`}>Type</th>
              <th className={`${TH} w-[74px]`}>Priority</th>
              <th className={`${TH} w-[96px]`}>Status</th>
              <th className={TH}>Assigned To</th>
              <th className={`${TH} w-[74px]`}>Completed</th>
            </tr>
          </thead>
          <tbody>
            {report.workOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="border border-[#888] px-2 py-4 text-center italic text-[#666]">
                  No work orders were created or completed this day.
                </td>
              </tr>
            )}
            {report.workOrders.map((w) => (
              <tr key={w.code} className="break-inside-avoid">
                <td className={`${TD} font-mono font-semibold`}>{w.code}</td>
                <td className={TD}>{w.title}</td>
                <td className={`${TD} font-mono`}>{w.machine}</td>
                <td className={TD}>{w.type === "PM" ? "PM" : "Corrective"}</td>
                <td className={TD}>{PRIORITY_SAP[w.priority ?? "NORMAL"] ?? w.priority}</td>
                <td className={`${TD} font-semibold`}>{w.status.replace(/_/g, " ")}</td>
                <td className={TD}>{w.assignedTo ?? "n/a"}</td>
                <td className={`${TD} font-mono`}>{w.completedAt ? fmtD(w.completedAt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 4 · SPARES ── */}
      <SectionTitle n={4} title="Spares Below Reorder" count={`${sparesLow.length} of ${spares.length} parts tracked need attention`} />
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[92px]`}>Part Code</th>
              <th className={TH}>Part</th>
              <th className={`${TH} w-[62px]`}>In Store</th>
              <th className={`${TH} w-[68px]`}>Reorder At</th>
              <th className={`${TH} w-[56px]`}>State</th>
            </tr>
          </thead>
          <tbody>
            {sparesLow.length === 0 && (
              <tr>
                <td colSpan={5} className="border border-[#888] px-2 py-4 text-center italic text-[#666]">
                  All tracked spares are at or above reorder level.
                </td>
              </tr>
            )}
            {sparesLow.map((p) => (
              <tr key={p.code} className="break-inside-avoid">
                <td className={`${TD} font-mono font-semibold`}>{p.code}</td>
                <td className={TD}>{p.name}</td>
                <td className={`${TD} text-center font-mono font-bold ${p.stock === 0 ? "text-[#b91c1c]" : ""}`}>{p.stock}</td>
                <td className={`${TD} text-center font-mono`}>{p.reorderLevel}</td>
                <td className={`${TD} font-bold ${p.stock === 0 ? "text-[#b91c1c]" : "text-[#b45309]"}`}>{p.stock === 0 ? "OUT" : "LOW"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 5 · REPORTING COVERAGE ── */}
      <SectionTitle n={5} title="Reporting Coverage" count={`${covered} of ${report.machines.length} machines fully covered`} />
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[86px]`}>Machine</th>
              <th className={TH}>Department</th>
              <th className={`${TH} w-[72px]`}>Components</th>
              <th className={`${TH} w-[62px]`}>Reported</th>
              <th className={TH}>Not Reported This Day</th>
            </tr>
          </thead>
          <tbody>
            {gapMachines.length === 0 && report.machines.length > 0 && (
              <tr>
                <td colSpan={5} className="border border-[#888] px-2 py-4 text-center italic text-[#666]">
                  Every registered component was reported today.
                </td>
              </tr>
            )}
            {gapMachines.map((m) => (
              <tr key={m.machineId} className="break-inside-avoid">
                <td className={`${TD} font-mono font-semibold`}>{m.code}</td>
                <td className={TD}>{m.departmentName ?? "n/a"}</td>
                <td className={`${TD} text-center font-mono`}>{m.logs.length + m.missing.length}</td>
                <td className={`${TD} text-center font-mono`}>{m.logs.length}</td>
                <td className={TD}>{m.missing.map((c) => c.name).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Signature footer ── */}
      <div className="mt-5 grid grid-cols-1 gap-3 border-t-2 border-[#111] pt-3 text-[10px] sm:grid-cols-3">
        <div>
          <p className="font-bold uppercase tracking-wide">Compiled By</p>
          <p className="mt-2 border-b border-dotted border-[#555] pb-0.5 italic">BrewOps · auto-compiled, immutable</p>
          <p className="mt-0.5 text-[8.5px] text-[#555]">System record is authoritative</p>
        </div>
        <div>
          <p className="font-bold uppercase tracking-wide">Checked By (Shift Engineer)</p>
          <p className="mt-2 border-b border-dotted border-[#555] pb-3">&nbsp;</p>
          <p className="mt-0.5 text-[8.5px] text-[#555]">Name &amp; signature</p>
        </div>
        <div>
          <p className="font-bold uppercase tracking-wide">Signature / Date</p>
          <p className="mt-2 border-b border-dotted border-[#555] pb-3">&nbsp;</p>
          <p className="mt-0.5 text-[8.5px] text-[#555]">Engineering &amp; Maintenance Dept.</p>
        </div>
      </div>

      <p className="mt-4 text-center text-[9px] italic text-[#555]">
        Generated by BrewOps · Digital Work Order &amp; PM System · Document {""}
        <span className="font-mono">IB-ENG-DR-001</span> Rev 02 · Printed copies are uncontrolled unless stamped · {fmtD(now.toISOString())}
      </p>
    </div>
  );
}

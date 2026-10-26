"use client";

// WoReportDocument — the executed Work Order rendered as the plant's paper SAP form
// ("WORK ORDER — Preventive Maintenance / Scheduled Inspection"): header meta box with
// barcode, safety preamble, functional-location block, numbered operations (0010/0020…)
// with Actual Start / Actual End / Name boxes, long-text task lists with ticks, and the
// Executioner Feedback / Supervisor Comments / signature footer. Print → clean A4.
// Rendered through a portal so the print stylesheet can hide the whole app cleanly.

import { createPortal } from "react-dom";
import WoBarcode from "./wo-barcode";
import type { MachineDTO, PmOperationDTO, WoStepDTO, WorkOrderDTO } from "@/lib/types";
import { CHECKIN_METHOD_LABEL, VERIFICATION_META, fmtDistance } from "@/lib/status";
import { X, Printer } from "lucide-react";

const PRIORITY_SAP: Record<string, string> = {
  URGENT: "1-Very high",
  HIGH: "2-High",
  NORMAL: "3-Medium",
  LOW: "4-Low",
};

const TRADE_LABEL: Record<string, string> = {
  MECHANICAL: "B-MA",
  ELECTRICAL: "B-EA",
};
const TRADE_FULL: Record<string, string> = {
  MECHANICAL: "Brewing Mechanical Artisan",
  ELECTRICAL: "Brewing Electrical Artisan",
};

function fmtD(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtT(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function legacyRef(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  const letter = String.fromCharCode(65 + (h % 26));
  return `I1${1 + (h % 3)}${(h >> 4) % 10}${letter}_0${2 + (h % 7)}`;
}

interface OpGroup {
  opIdx: number;
  opName: string;
  trade: string;
  steps: WoStepDTO[];
  start: string | null;
  end: string | null;
}

function buildOps(wo: WorkOrderDTO, templateOps: PmOperationDTO[] | null | undefined): OpGroup[] {
  const groups: OpGroup[] = [];
  const hasOps = wo.steps.some((s) => s.opIdx !== null);
  if (hasOps) {
    for (const s of wo.steps) {
      const key = s.opIdx ?? 10;
      let g = groups.find((x) => x.opIdx === key);
      if (!g) {
        const tpl = templateOps?.find((o) => o.idx === key);
        g = {
          opIdx: key,
          opName: s.opName ?? tpl?.subAssembly ?? "GENERAL",
          trade: tpl?.trade ?? wo.assignedToTrade ?? "MECHANICAL",
          steps: [],
          start: null,
          end: null,
        };
        groups.push(g);
      }
      g.steps.push(s);
    }
  } else {
    groups.push({
      opIdx: 10,
      opName: "GENERAL MACHINE",
      trade: wo.assignedToTrade ?? "MECHANICAL",
      steps: wo.steps,
      start: null,
      end: null,
    });
  }
  for (const g of groups) {
    const times = g.steps.map((s) => s.doneAt).filter(Boolean) as string[];
    g.start = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
    g.end = times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
  }
  return groups;
}

function DateBox({ value, wide = false }: { value: string; wide?: boolean }) {
  return (
    <span className={`inline-flex h-7 items-center justify-center border border-[#555] bg-white px-2 font-mono text-[11px] ${wide ? "w-[110px]" : "w-[64px]"}`}>
      {value}
    </span>
  );
}

export default function WoReportDocument({
  wo,
  machine,
  templateOps,
  org,
  onClose,
}: {
  wo: WorkOrderDTO;
  machine?: MachineDTO | null;
  templateOps?: PmOperationDTO[] | null;
  org?: { name: string; logoUrl: string | null } | null;
  onClose: () => void;
}) {
  const ops = buildOps(wo, templateOps);
  const isPm = wo.type === "PM";
  const doneCount = wo.steps.filter((s) => s.doneAt).length;
  const executed = wo.status === "COMPLETED";
  // The overlay only ever opens from a user event (never during SSR/hydration) —
  // a plain document guard is enough to keep createPortal server-safe.
  if (typeof document === "undefined") return null;

  const components = machine?.components ?? [];
  const condition = components.some((c) => ["BROKEN", "LOTO"].includes(c.currentStatus))
    ? "Not Running"
    : components.some((c) => ["BYPASS", "SIMULATION", "FAULTY", "AWAITING_SPARES"].includes(c.currentStatus))
      ? "Running (Attention)"
      : components.length
        ? "Running"
        : "Not Running";

  const maintPlanDigits = wo.templateCode?.replace(/\D/g, "") ?? "";
  const functionalLoc = machine?.functionalLoc ?? `1Nl-B-${wo.machineCode.replace(/-/g, "")}`;
  const equipmentNo = machine?.equipmentNo ?? "";

  return createPortal(
    <div className="wo-print-root fixed inset-0 z-[60] overflow-y-auto bg-black/80 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="wo-print-toolbar sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-[#17140f]/95 px-4 py-2.5 backdrop-blur">
        <p className="text-xs font-semibold text-white/90">
          WO Report <span className="font-mono text-white/50">{wo.code}</span>
          <span className="ml-2 hidden text-[10px] text-white/40 sm:inline">printed form · {isPm ? "Preventive Maintenance" : "Corrective Maintenance"}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-[#111] hover:bg-white/90"
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
        {/* ── Masthead — logo left (it carries the company name), form title + document-control strip ALWAYS visible in the middle (screen & print — never rely on print: display variants), meta table right. Stacks centered on phones. ── */}
        <div className="flex flex-col items-center gap-2 border-b-2 border-[#111] pb-3 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-x-4 sm:text-left">
          {org?.logoUrl ? (
            <img src={org.logoUrl} alt={`${org.name} logo`} className="h-16 w-auto max-w-[190px] shrink-0 object-contain sm:h-24 sm:max-w-[240px]" />
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">
              <svg viewBox="0 0 40 40" className="h-14 w-14 shrink-0 sm:h-16 sm:w-16" aria-hidden="true">
                <circle cx="20" cy="20" r="19" fill="none" stroke="#111" strokeWidth="1.6" />
                <path d="M20 6 C13 14 11 22 20 34 C29 22 27 14 20 6 Z" fill="none" stroke="#111" strokeWidth="1.6" />
                <path d="M20 10 L20 30 M20 16 L14.5 12.5 M20 16 L25.5 12.5 M20 23 L14 19 M20 23 L26 19" stroke="#111" strokeWidth="1.4" fill="none" />
              </svg>
              <div className="min-w-0">
                <p className="text-[13px] font-black leading-tight tracking-tight sm:text-[15px]">{org?.name ?? "INTERNATIONAL BREWERIES PLC."}</p>
                <p className="mt-0.5 text-[8px] italic text-[#444] sm:text-[9px]">Maintenance Department · Work Order &amp; PM System</p>
              </div>
            </div>
          )}
          <div className="min-w-0 flex-1 sm:px-2">
            <h1 className="text-2xl font-black tracking-wide sm:text-3xl">WORK ORDER</h1>
            <p className="mt-0.5 text-sm font-semibold sm:text-base">{isPm ? "Preventive Maintenance" : "Corrective Maintenance"}</p>
            {isPm && <p className="mt-0.5 text-[12px] font-semibold italic underline underline-offset-4 sm:text-[13px]">Scheduled Inspection</p>}
            {/* Document control strip — the controlled-form text that fills the letterhead zone under the title */}
            <div className="mt-2 border-t border-dotted border-[#777] pt-1.5 text-[9px] leading-[1.7] text-[#222] sm:text-[9.5px]">
              <p>
                <span className="font-bold">Document Ref.:</span> <span className="font-mono">IB-ENG-WO-001</span>
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
            <div className="hidden sm:block">
              <WoBarcode seed={wo.code} height={30} bars={40} />
            </div>
            <table className="w-[190px] max-w-full border-collapse text-[10px] sm:text-[11px]">
              <tbody>
                {[
                  ["Page", "1/1"],
                  ["Order Number", wo.code.replace("WO-", "")],
                  ["Superior Order", ""],
                  ["Printed On", fmtD(wo.createdAt)],
                  ["Printed By", wo.createdByName ?? "Engineering"],
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

        {/* Safety preamble */}
        <p className="mt-3 text-[10.5px] font-bold italic leading-snug text-[#222] sm:text-[11.5px]">
          Please note : Safety is your responsibility. Use Personal Protective Equipment, Follow all Lockout, Permit and
          Safety Instructions when applicable DO NOT proceed unless you have received basic safety induction training.
        </p>

        {/* ── Info block ── */}
        <div className="mt-3 border-2 border-[#111] px-3 py-2 text-[11px] sm:text-[12px]">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="min-w-0">
              <span className="font-bold">WO Description:</span>{" "}
              <span className="font-bold">{wo.title}</span>
            </p>
            <p className="shrink-0 whitespace-nowrap"><span className="font-bold">Priority:</span> {PRIORITY_SAP[wo.priority] ?? wo.priority}</p>
          </div>
          <div className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <p className="flex flex-wrap gap-x-3">
                <span className="w-[136px] shrink-0 font-bold">Functional Loc.:</span>
                <span className="font-mono">{functionalLoc}</span>
                <span className="italic text-[#333]">- {machine?.departmentName ?? "Brewery"}</span>
              </p>
              <p className="flex flex-wrap gap-x-3">
                <span className="w-[136px] shrink-0 font-bold">Equipment:</span>
                <span className="font-mono">{equipmentNo}</span>
                <span className="italic text-[#333]">- {wo.machineCode} {wo.machineName}</span>
              </p>
              <p className="flex flex-wrap gap-x-3">
                <span className="w-[136px] shrink-0 font-bold">Maintenance Plant:</span>
                <span className="font-mono">NG02</span>
                <span className="text-[#333]">ABI Ilesha Brewery</span>
                <span className="font-bold">Maintenance Planner</span>
                <span className="font-mono">B1</span>
                {maintPlanDigits && <span className="font-bold">Maint.Plan: <span className="font-mono">{maintPlanDigits}</span></span>}
              </p>
              <p className="flex flex-wrap gap-x-3">
                <span className="w-[136px] shrink-0 font-bold">Machine Condition:</span>
                <span>{condition}</span>
                {wo.frequency && <><span className="font-bold">Grp Num.:</span> <span className="font-mono">{wo.frequency.slice(0, 3)}</span></>}
                <span className="font-bold">Grp Counter.:</span> <span className="font-mono">1</span>
              </p>
            </div>
            <div className="space-y-1 text-right sm:pl-4">
              <p><span className="font-bold">Notification Number:</span> <span className="font-mono">&nbsp;</span></p>
              <p><span className="font-bold">Legacy Ref.:</span> <span className="font-mono">{legacyRef(`${wo.code}${wo.machineCode}`)}</span></p>
              <p><span className="font-bold">WO Status:</span> <span className="font-mono">{executed ? "COMPLETED" : wo.status}</span></p>
            </div>
          </div>
        </div>

        {/* ── Operations ── */}
        {ops.map((op) => {
          const opNo = String(op.opIdx).padStart(4, "0");
          const tradeCode = TRADE_LABEL[op.trade] ?? "B-MA";
          const tradeFull = TRADE_FULL[op.trade] ?? "Brewing Mechanical Artisan";
          return (
            <div key={op.opIdx} className="mt-4 break-inside-avoid">
              <div className="flex items-center justify-between gap-3 border-b border-[#888] pb-1.5">
                <p className="text-[11.5px] font-bold">Start Date: <span className="font-mono font-normal">{fmtD(wo.startedAt ?? wo.dueDate)}</span></p>
                <WoBarcode seed={`${wo.code}-${op.opIdx}`} height={22} bars={34} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] sm:text-[12px]">
                <span className="font-mono font-bold">{opNo}</span>
                <span><span className="font-bold">{tradeCode}</span> <span className="text-[#222]">{tradeFull}</span></span>
                <span className="uppercase">Sub Assembly: <span className="font-semibold">{op.opName}</span></span>
                <span className="text-[#333]">Employee -</span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2 text-[11.5px] sm:text-[12px]">
                <span className="flex items-center gap-1.5">
                  <span className="font-bold">Actual Start</span>
                  <DateBox value={fmtD(op.start)} wide />
                  <DateBox value={fmtT(op.start)} />
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="font-bold">Actual End</span>
                  <DateBox value={fmtD(op.end)} wide />
                  <DateBox value={fmtT(op.end)} />
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="font-bold">Name</span>
                  <span className="inline-flex h-7 min-w-[150px] max-w-full items-center justify-center border border-[#555] bg-white px-2 text-[12px] italic">
                    {wo.assignedToName ?? ""}
                  </span>
                </span>
              </div>
              <p className="mt-2.5 text-[12px] font-semibold">Operation{opNo} : Long Text -</p>
              <ul className="mt-1 space-y-1 pl-2">
                {op.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-[11.5px] leading-snug sm:text-[12px]">
                    <span className={`mt-px shrink-0 font-bold ${s.doneAt ? "text-[#0a5c2f]" : "text-[#999]"}`}>{s.doneAt ? "✓" : "○"}</span>
                    <span className="min-w-0 flex-1">{s.text}</span>
                    {s.doneAt && <span className="shrink-0 font-mono text-[9.5px] text-[#666]">{fmtD(s.doneAt)} {fmtT(s.doneAt)}</span>}
                  </li>
                ))}
                {op.steps.length === 0 && <li className="pl-5 text-[11.5px] italic text-[#777]">No tasks recorded.</li>}
              </ul>
            </div>
          );
        })}

        {/* ── Sign-off footer ── */}
        <div className="mt-6 space-y-3 break-inside-avoid">
          <div className="border border-[#333]">
            <p className="border-b border-[#333] bg-[#f3f3f3] px-2.5 py-1 text-[11.5px] font-bold">Executioner Feedback:</p>
            <p className="min-h-[72px] px-2.5 py-2 text-[12px] italic leading-relaxed">{wo.feedback ?? ""}</p>
          </div>
          <div className="border border-[#333]">
            <p className="border-b border-[#333] bg-[#f3f3f3] px-2.5 py-1 text-[11.5px] font-bold">Supervisor Comments:</p>
            <p className="min-h-[56px] px-2.5 py-2 text-[12px] leading-relaxed">{wo.supervisorComment ?? ""}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 border border-[#333] px-3 py-3 text-[11.5px] sm:grid-cols-2 sm:text-[12px]">
            <div>
              <p className="flex items-end gap-1">
                <span className="shrink-0 font-bold">Executioner Name &amp; Signature:</span>
                <span className="min-w-0 flex-1 border-b border-dotted border-[#555] pb-0.5 text-center italic">{wo.assignedToName ?? ""}</span>
              </p>
              <p className="mt-2.5 flex items-end gap-1 sm:pl-10">
                <span className="shrink-0 font-bold">Date:</span>
                <span className="min-w-0 flex-1 border-b border-dotted border-[#555] pb-0.5 text-center font-mono">{fmtD(wo.completedAt)}</span>
              </p>
            </div>
            <div>
              <p className="flex items-end gap-1">
                <span className="shrink-0 font-bold">Supervisor Name &amp; Signature:</span>
                <span className="min-w-0 flex-1 border-b border-dotted border-[#555] pb-0.5 text-center italic">
                  {wo.supervisorComment ? wo.createdByName ?? "" : ""}
                </span>
              </p>
              <p className="mt-2.5 flex items-end gap-1 sm:pl-10">
                <span className="shrink-0 font-bold">Date:</span>
                <span className="min-w-0 flex-1 border-b border-dotted border-[#555] pb-0.5 text-center font-mono">
                  {wo.supervisorComment ? fmtD(wo.createdAt) : ""}
                </span>
              </p>
            </div>
          </div>
          {/* On-site evidence strip — the digital counterfoil of the paper form */}
          {(wo.checkInAt || wo.evidence.length > 0 || wo.verification === "OVERRIDE") && (
            <div className="border border-[#333] px-2.5 py-2 text-[10px] leading-relaxed">
              <span className="font-bold">On-site Evidence:</span>{" "}
              {wo.checkInAt && (
                <>Check-in via {CHECKIN_METHOD_LABEL[wo.checkInMethod ?? "CODE"]}
                  {wo.checkInDistanceM != null ? ` (${fmtDistance(wo.checkInDistanceM)} from equipment tag)` : ""}
                  {" · "}{fmtD(wo.checkInAt)} {fmtT(wo.checkInAt)} ·{" "}
                </>
              )}
              {wo.evidence.length > 0 && <>{wo.evidence.length} evidence photo{wo.evidence.length === 1 ? "" : "s"} · </>}
              GPS-stamped steps {wo.steps.filter((s) => s.distanceM != null).length}/{wo.steps.length} ·{" "}
              <span className="font-bold">Verification: {(VERIFICATION_META[wo.verification] ?? VERIFICATION_META.PENDING).label}</span>
              {wo.overrideByName && <> by {wo.overrideByName}</>}
            </div>
          )}
          <p className="text-center text-[9px] tracking-wider text-[#888]">
            BrewOps Digital Work Order &amp; PM System · {wo.code} · {doneCount}/{wo.steps.length} tasks verified · audit record {executed ? "locked" : "open"}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

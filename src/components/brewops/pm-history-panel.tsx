"use client";

// PmHistoryPanel — "search a machine → see every PM carried on it and the artisans who took them".
// Used inline on the engineer's Registry machine detail and as a sheet on the artisan's Round view.
// Tapping a work order opens the SAP-style WO report document.

import { useEffect, useState } from "react";
import { fetchMachineHistory } from "@/lib/client-api";
import type { BootstrapData, MachineDTO, MachinePmHistory, WorkOrderDTO } from "@/lib/types";
import { FREQUENCY_CHIP, WO_STATUS_META, tradeMeta, fmtDateTime } from "@/lib/status";
import { FREQUENCY_META } from "@/lib/types";
import WoReportDocument from "./wo-report-document";
import { LoaderCircle, FileText, UsersRound, ClipboardList, CircleCheck, Timer, History } from "lucide-react";

export default function PmHistoryPanel({
  machineId,
  machineCode,
  data,
}: {
  machineId: string;
  machineCode: string;
  data: BootstrapData;
}) {
  const [history, setHistory] = useState<MachinePmHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WorkOrderDTO | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMachineHistory(machineId)
      .then((h) => {
        if (alive) setHistory(h);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load history");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [machineId]);

  const machineDTO: MachineDTO | undefined = data.machines.find((m) => m.id === machineId);
  const templateOps = (code: string | null) =>
    data.pmTemplates?.find((t) => t.code === code)?.operations ?? null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Loading PM history for {machineCode}…
      </div>
    );
  }
  if (error || !history) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-xs text-red-300">
        {error ?? "History unavailable."}
      </div>
    );
  }

  const s = history.summary;
  const pmOrders = history.orders.filter((w) => w.type === "PM");
  const corrective = history.orders.filter((w) => w.type !== "PM");

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" /> PM record · {history.machine.code} {history.machine.name}
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          <div className="rounded-xl bg-secondary/60 px-3 py-2">
            <p className="text-muted-foreground text-[10px]">PMs completed</p>
            <p className="text-base font-bold text-emerald-400">{s.completedPm}</p>
          </div>
          <div className="rounded-xl bg-secondary/60 px-3 py-2">
            <p className="text-muted-foreground text-[10px]">Last 30 days</p>
            <p className="text-base font-bold">{s.pmsLast30d}</p>
          </div>
          <div className="rounded-xl bg-secondary/60 px-3 py-2">
            <p className="text-muted-foreground text-[10px]">Currently open</p>
            <p className="text-base font-bold text-amber-400">{s.openPm}</p>
          </div>
          <div className="rounded-xl bg-secondary/60 px-3 py-2 min-w-0">
            <p className="text-muted-foreground text-[10px]">Last PM</p>
            <p className="text-[13px] font-bold truncate">
              {s.lastPmAt ? fmtDateTime(s.lastPmAt) : "No PM yet"}
              {s.lastPmCode && <span className="ml-1 font-mono text-[10px] text-muted-foreground">{s.lastPmCode}</span>}
            </p>
          </div>
        </div>
        {(history.machine.functionalLoc || history.machine.equipmentNo) && (
          <p className="mt-2.5 text-[10px] font-mono text-muted-foreground">
            {history.machine.functionalLoc || ""}{history.machine.functionalLoc && history.machine.equipmentNo ? " · " : ""}{history.machine.equipmentNo ? `EQ-${history.machine.equipmentNo}` : ""}
          </p>
        )}
      </div>

      {/* Artisan execution ledger */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <p className="px-4 pt-3.5 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <UsersRound className="h-3.5 w-3.5" /> Artisans who took the PM ({history.artisans.length})
        </p>
        {history.artisans.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">No executed PMs recorded on this machine yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {history.artisans.map((a) => {
              const trade = tradeMeta(a.trade);
              return (
                <div key={a.userId} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="h-8 w-8 shrink-0 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-[10px] font-bold text-primary">
                    {a.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate flex items-center gap-1.5">
                      {a.name}
                      {trade && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${trade.cls}`}>{trade.code}</span>}
                      {a.shift && <span className="text-[9px] text-muted-foreground">Shift {a.shift}</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {a.pmCount} PM{a.pmCount === 1 ? "" : "s"}
                      {a.correctiveCount > 0 && ` · ${a.correctiveCount} corrective`}
                      {a.lastPmAt && ` · last ${fmtDateTime(a.lastPmAt)}`}
                      {a.lastWoCode && <span className="font-mono"> · {a.lastWoCode}</span>}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-secondary border border-border px-2 py-1 text-[11px] font-bold">{a.pmCount}×</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Work order record */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5" /> Work order record ({history.orders.length}) · tap to view the printed WO report
        </p>
        <div className="space-y-1.5">
          {history.orders.length === 0 && (
            <p className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground text-center">
              No work orders on this machine yet.
            </p>
          )}
          {[...pmOrders, ...corrective].map((w) => {
            const trade = tradeMeta(w.assignedToTrade);
            const isDone = w.status === "COMPLETED";
            return (
              <button
                key={w.id}
                onClick={() => setReport(w)}
                className="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-left hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold truncate min-w-0">
                    <span className="font-mono text-[10px] text-muted-foreground mr-1.5">{w.code}</span>
                    {w.title}
                  </p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold ${WO_STATUS_META[w.status].cls}`}>
                    {WO_STATUS_META[w.status].label}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
                  {w.type === "PM" ? (
                    <>
                      <History className="h-3 w-3" /> PM
                      {w.frequency && (
                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${FREQUENCY_CHIP[w.frequency]}`}>
                          {FREQUENCY_META[w.frequency]?.short ?? w.frequency}
                        </span>
                      )}
                    </>
                  ) : (
                    <><Timer className="h-3 w-3 text-red-400" /> Corrective</>
                  )}
                  {w.templateCode && <span className="font-mono">· {w.templateCode}</span>}
                  {w.assignedToName && (
                    <span className="inline-flex items-center gap-1">
                      · {w.assignedToName}
                      {trade && <span className={`rounded-full border px-1 py-0.5 text-[8px] font-bold ${trade.cls}`}>{trade.code}</span>}
                    </span>
                  )}
                  {isDone && w.completedAt && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-400/90">
                      <CircleCheck className="h-3 w-3" /> {fmtDateTime(w.completedAt)}
                    </span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1 text-primary font-semibold">
                    <FileText className="h-3 w-3" /> Report
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {report && (
        <WoReportDocument
          wo={report}
          machine={machineDTO ?? null}
          templateOps={templateOps(report.templateCode)}
          org={data.org}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  );
}

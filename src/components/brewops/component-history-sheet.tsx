"use client";

import { StatusBadge } from "@/components/brewops/status-badge";
import { fmtDateTime } from "@/lib/status";
import type { ComponentDTO, Status, StatusLogDTO } from "@/lib/types";
import { X, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Component history sheet — the immutable timestamped trail for one component.
 * Fetches full history from /api/components/[id] when opened.
 * Bottom sheet on mobile, centered dialog on desktop; body scrolls internally.
 */
export default function ComponentHistorySheet({
  component, machineCode, onClose,
}: {
  component: ComponentDTO | null;
  machineCode: string;
  onClose: () => void;
}) {
  if (!component) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-6 animate-in fade-in-0 duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${component.name} history`}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border shadow-2xl max-h-[92dvh] sm:max-h-[86dvh] flex flex-col overflow-hidden text-left animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <HistoryContent key={component.id} component={component} machineCode={machineCode} onClose={onClose} />
      </div>
    </div>
  );
}

function HistoryContent({
  component, machineCode, onClose,
}: {
  component: ComponentDTO;
  machineCode: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<StatusLogDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/components/${component.id}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load history");
        if (!cancelled) setLogs(json.logs as StatusLogDTO[]);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [component.id]);

  return (
    <>
      <div className="shrink-0 p-4 pb-2.5 border-b border-border/70">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">{component.name} · History</h2>
            <p className="text-xs text-muted-foreground">{machineCode} · every entry is timestamped &amp; immutable</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto brewops-scroll px-4 py-3 pb-6">
        {logs === null && (
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-8">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading history…
          </p>
        )}
        {logs !== null && logs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No records yet. History builds as statuses are logged.</p>
        )}
        {logs !== null && logs.length > 0 && (
          <ol className="relative border-l border-border ml-2 space-y-4 py-1">
            {logs.map((h, i) => {
              const dot = STATUS_DOT(h.status);
              return (
                <li key={h.id} className="ml-4">
                  <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-card ${dot}`} />
                  <div className="rounded-xl bg-background border border-border p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <StatusBadge status={h.status} />
                      <span className="text-[10px] text-muted-foreground font-mono">{fmtDateTime(h.createdAt)}</span>
                    </div>
                    {i === 0 && (
                      <p className="text-[10px] text-primary font-semibold mt-1.5">LATEST · current status of this component</p>
                    )}
                    {h.note && <p className="text-xs mt-1.5 leading-relaxed">{h.note}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                      <span>by {h.userName}</span>
                      {h.distanceM != null && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 font-semibold">
                          on-site · {h.distanceM < 1000 ? `${Math.round(h.distanceM)} m` : `${(h.distanceM / 1000).toFixed(1)} km`}
                        </span>
                      )}
                    </p>
                    {h.photo && (
                      <img src={h.photo} alt="Evidence photo" className="mt-2 rounded-lg border border-border max-h-40 object-cover" />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </>
  );
}

// Dot color per status
function STATUS_DOT(status: Status): string {
  switch (status) {
    case "WORKING": return "bg-emerald-400";
    case "STANDBY": return "bg-teal-400";
    case "SIMULATION": return "bg-violet-400";
    case "BYPASS": return "bg-amber-400";
    case "FAULTY": return "bg-orange-400";
    case "MAINTENANCE": return "bg-cyan-400";
    case "AWAITING_SPARES": return "bg-fuchsia-400";
    case "BROKEN": return "bg-red-500";
    case "LOTO": return "bg-zinc-950 ring-1 ring-yellow-400";
    case "COMMISSIONING": return "bg-lime-400";
    default: return "bg-zinc-400";
  }
}

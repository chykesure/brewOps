"use client";

// Audit tab — the console's own operation trail. Every unlock, backup,
// restore, reset, license flip, revocation and maintenance toggle is recorded
// here with a timestamp, filterable by action.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ListChecks, LoaderCircle, ScrollText, Trash2 } from "lucide-react";
import { devAudit, devAuditClear, type DevAuditData } from "@/lib/client-api";
import { ActionChip, SectionCard, fmtWhen } from "./shared";

export default function AuditTab({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<DevAuditData | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    try {
      const d = await devAudit();
      setData(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the audit trail");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.counts).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "ALL") return data.events;
    return data.events.filter((e) => e.action === filter);
  }, [data, filter]);

  const wipe = async () => {
    try {
      const res = await devAuditClear("WIPE");
      toast.success(`Audit trail cleared (${res.deleted} event(s))`);
      setWipeConfirm("");
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Wipe failed");
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        icon={ScrollText}
        title="Operation audit trail"
        desc={data ? `Every console operation on record — ${data.total} event(s), showing the ${data.shown} most recent.` : "Every console operation, recorded automatically."}
      >
        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("ALL")}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${filter === "ALL" ? "border-primary/50 bg-primary/15 text-primary" : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"}`}
          >
            All{data ? ` · ${data.shown}` : ""}
          </button>
          {actions.map(([action, count]) => (
            <button
              key={action}
              onClick={() => setFilter(action)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors ${filter === action ? "border-primary/50 bg-primary/15 text-primary" : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"}`}
            >
              {action.replace(/_/g, " ").toLowerCase()} · {count}
            </button>
          ))}
        </div>

        {/* Event list */}
        <div className="mt-3 rounded-xl border border-border overflow-hidden">
          <div className="max-h-[28rem] overflow-y-auto brewops-scroll">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-3 py-2 font-bold">When</th>
                  <th className="px-3 py-2 font-bold">Action</th>
                  <th className="px-3 py-2 font-bold">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data === null && (
                  <tr><td colSpan={3} className="px-3 py-8 text-center text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin inline" /></td></tr>
                )}
                {data !== null && filtered.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-8 text-center text-xs text-muted-foreground">Nothing recorded for this filter yet.</td></tr>
                )}
                {filtered.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtWhen(e.createdAt)}</td>
                    <td className="px-3 py-2.5"><ActionChip action={e.action} /></td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground break-words">{e.detail ?? <span className="italic opacity-60">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </SectionCard>

      <SectionCard icon={Trash2} title="Clear the audit trail" desc="Wipes every recorded event. The wipe itself becomes the first entry of the fresh trail — the console never loses its starting marker." tone="danger">
        <div className="flex gap-2">
          <input
            type="text"
            value={wipeConfirm}
            onChange={(e) => setWipeConfirm(e.target.value)}
            placeholder='Type "WIPE"'
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={() => void wipe()}
            disabled={wipeConfirm !== "WIPE" || busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
            Clear trail
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

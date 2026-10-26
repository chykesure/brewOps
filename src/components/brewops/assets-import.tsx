"use client";

// AssetsImport — bulk-load the plant's real equipment: paste or attach a CSV of
// MACHINE + COMPONENT rows, preview the validated rows, then commit. The template
// and the current register round-trip through the same format.

import { useRef, useState } from "react";
import { importAssets, type ImportCommitResult, type ImportPreview } from "@/lib/client-api";
import { toast } from "sonner";
import {
  X, Upload, FileDown, LoaderCircle, CheckCircle2, AlertTriangle,
  CirclePlus, PencilLine, Table2,
} from "lucide-react";

export default function AssetsImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [committed, setCommitted] = useState<ImportCommitResult | null>(null);
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (f: File | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      toast.error("Attach a .csv file (export your Excel sheet as CSV)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setCsv(String(reader.result ?? "")); setPreview(null); setCommitted(null); };
    reader.readAsText(f);
  };

  const validate = async () => {
    if (!csv.trim()) { toast.error("Paste CSV text or attach a .csv file first."); return; }
    setBusy("validate");
    try {
      const res = await importAssets(csv, false);
      if (res.commit === false) setPreview(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    setBusy("commit");
    try {
      const res = await importAssets(csv, true);
      if (res.commit === true) {
        setCommitted(res);
        setPreview(null);
        toast.success(
          `Imported ${res.createdMachines} new + ${res.updatedMachines} updated machines, ${res.createdComponents} components`,
          { description: res.createdParts ? `${res.createdParts} new spare parts created` : undefined },
        );
        onImported();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border p-5 space-y-3 max-h-[92vh] overflow-y-auto brewops-scroll" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold">Bulk equipment import</p>
            <p className="text-[11px] text-muted-foreground">Load your real machines &amp; sub-components from a spreadsheet. Validate first, commit when clean.</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href="/api/assets/import?template=1"
            className="h-9 px-3 rounded-xl border border-border bg-secondary text-xs font-semibold flex items-center gap-1.5 hover:bg-accent"
          >
            <FileDown className="h-3.5 w-3.5" /> CSV template
          </a>
          <a
            href="/api/assets/export"
            className="h-9 px-3 rounded-xl border border-border bg-secondary text-xs font-semibold flex items-center gap-1.5 hover:bg-accent"
          >
            <FileDown className="h-3.5 w-3.5" /> Export current assets
          </a>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
          <button
            onClick={() => fileRef.current?.click()}
            className="h-9 px-3 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs font-bold flex items-center gap-1.5 hover:bg-primary/20"
          >
            <Upload className="h-3.5 w-3.5" /> Attach .csv file
          </button>
        </div>

        <textarea
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setPreview(null); setCommitted(null); }}
          rows={6}
          placeholder={"type,code,name,department,location,functionalLoc,equipmentNo,pmCycle,pmDay,ownerEmail,lat,lng,machineCode,partCode,category\nMACHINE,P-210,Mash Tun Agitator,Brewhouse,Brewhouse Hall A,1Nl-B-BR1-P210-MAT,10000210,WEEKLY,1,yusuf@brewops.ng,,,\nCOMPONENT,,Gearbox Oil Seal,,,,,,,,,,P-210,SK-12,Seal"}
          className="w-full rounded-xl bg-background border border-input px-3 py-2.5 text-[11px] font-mono outline-none focus:ring-2 focus:ring-primary/50 resize-none leading-relaxed"
        />

        <div className="flex items-center gap-2">
          <button onClick={validate} disabled={busy !== null} className="h-10 px-4 rounded-xl bg-secondary border border-border text-xs font-bold flex items-center gap-1.5 hover:bg-accent disabled:opacity-50">
            {busy === "validate" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Table2 className="h-3.5 w-3.5" />} Validate rows
          </button>
          {preview && preview.errors === 0 && (
            <button onClick={commit} disabled={busy !== null || preview.valid === 0} className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
              {busy === "commit" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CirclePlus className="h-3.5 w-3.5" />}
              Import {preview.valid} row{preview.valid === 1 ? "" : "s"}
            </button>
          )}
          {preview && (
            <span className={`text-[11px] font-bold ${preview.errors > 0 ? "text-red-400" : "text-emerald-400"}`}>
              {preview.valid} ready · {preview.errors} with errors
            </span>
          )}
        </div>

        {committed && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-3 text-[12px]">
            <p className="font-bold text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Import complete</p>
            <p className="mt-1 text-emerald-200/90">
              {committed.createdMachines} new machines · {committed.updatedMachines} updated · {committed.createdComponents} components · {committed.createdParts} new parts.
              {committed.errors.length > 0 && ` ${committed.errors.length} row(s) skipped. See below.`}
            </p>
            {committed.errors.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {committed.errors.map((e, i) => <li key={i} className="text-[11px] text-red-300">· {e}</li>)}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">New machines get a nameplate check-in code automatically. Open each machine once to capture its GPS position, then artisans check in with zero printing.</p>
          </div>
        )}

        {preview && (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto brewops-scroll">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                  <tr className="text-left">
                    <th className="px-2.5 py-2 font-bold">#</th>
                    <th className="px-2.5 py-2 font-bold">Type</th>
                    <th className="px-2.5 py-2 font-bold">Code</th>
                    <th className="px-2.5 py-2 font-bold">Name</th>
                    <th className="px-2.5 py-2 font-bold">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {preview.results.map((r) => (
                    <tr key={r.row} className={r.status === "ERROR" ? "bg-red-500/5" : ""}>
                      <td className="px-2.5 py-1.5 font-mono text-muted-foreground">{r.row}</td>
                      <td className="px-2.5 py-1.5 font-semibold">{r.type}</td>
                      <td className="px-2.5 py-1.5 font-mono">{r.code}</td>
                      <td className="px-2.5 py-1.5 max-w-[180px] truncate" title={r.name}>{r.name}</td>
                      <td className="px-2.5 py-1.5">
                        {r.status === "ERROR" && <span className="text-red-400 font-semibold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {r.message}</span>}
                        {r.status === "CREATE" && <span className="text-emerald-400 flex items-center gap-1"><CirclePlus className="h-3 w-3" /> {r.message}</span>}
                        {r.status === "UPDATE" && <span className="text-cyan-300 flex items-center gap-1"><PencilLine className="h-3 w-3" /> {r.message}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <b>Rules:</b> MACHINE rows need code, name, department (created if new). Optional ownerEmail must match an existing artisan; lat+lng together.
          COMPONENT rows need machineCode (existing or earlier in the file) and name. partCode links to spares stock or creates a new part at stock 0.
          Existing machine codes are updated, never duplicated.
        </p>
      </div>
    </div>
  );
}

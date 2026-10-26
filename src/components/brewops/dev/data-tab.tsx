"use client";

// Data tab — downloads, server-stored restore points, file restore and the
// danger zone (activity purge / factory reset).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive, DatabaseBackup, Download, Factory, HardDriveDownload, History, LoaderCircle,
  Plus, Trash2, Upload,
} from "lucide-react";
import {
  devBackupCreate, devBackupDelete, devBackupRestorePoint, devBackups, devReset, devRestore,
  type DevBackupMeta,
} from "@/lib/client-api";
import { SectionCard, fmtBytes, fmtWhen } from "./shared";

export default function DataTab({ onChanged }: { onChanged?: () => void }) {
  const [backups, setBackups] = useState<DevBackupMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [pointConfirm, setPointConfirm] = useState("");
  const [clearConfirm, setClearConfirm] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setCreating(true);
    try {
      const b = await devBackups();
      setBackups(b.backups);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load restore points");
    } finally {
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createPoint = async () => {
    setCreating(true);
    try {
      const res = await devBackupCreate();
      toast.success(`Restore point created · ${res.rows} rows`);
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setCreating(false);
    }
  };

  const deletePoint = async (file: string) => {
    setBusyFile(file);
    try {
      await devBackupDelete(file);
      toast.success("Restore point deleted");
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyFile(null);
    }
  };

  const restorePoint = async (file: string) => {
    if (pointConfirm !== file) {
      toast.error("Type the file name exactly in the confirmation box first.");
      return;
    }
    setBusyFile(file);
    try {
      const res = await devBackupRestorePoint(file, "RESTORE");
      const total = Object.values(res.restored).reduce((a, b) => a + b, 0);
      toast.success(`Rolled back to ${file} (${total} records)`);
      setPointConfirm("");
      await load(true);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusyFile(null);
    }
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);
      const res = await devRestore(backup, restoreConfirm);
      const total = Object.values(res.restored).reduce((a, b) => a + b, 0);
      toast.success(`Backup restored (${total} records)`);
      setRestoreFile(null);
      setRestoreConfirm("");
      if (fileRef.current) fileRef.current.value = "";
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    }
  };

  const doReset = async (mode: "activity" | "factory") => {
    const confirm = mode === "activity" ? clearConfirm : resetConfirm;
    try {
      const res = await devReset(mode, confirm);
      const total = Object.values(res.deleted).reduce((a, b) => a + b, 0);
      toast.success(mode === "activity" ? `Activity data cleared (${total} records)` : "Factory reset complete");
      setClearConfirm("");
      setResetConfirm("");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    }
  };

  return (
    <div className="space-y-6">
      {/* ---- Downloads ---- */}
      <SectionCard icon={DatabaseBackup} title="Download backups" desc="Keep copies outside the server before any risky operation. The .db file is a drop-in copy of the raw database; the JSON snapshot can be restored below.">
        <div className="grid md:grid-cols-2 gap-3">
          <a
            href="/api/dev/backup?format=db"
            className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-4 hover:bg-accent/50 transition-colors"
          >
            <Download className="h-5 w-5 text-primary shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Download database file</span>
              <span className="block text-[11px] text-muted-foreground">Complete SQLite file (.db) - everything in one file</span>
            </span>
          </a>
          <a
            href="/api/dev/backup?format=json"
            className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-4 hover:bg-accent/50 transition-colors"
          >
            <Download className="h-5 w-5 text-primary shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Download JSON snapshot</span>
              <span className="block text-[11px] text-muted-foreground">Every table as readable JSON - restorable below</span>
            </span>
          </a>
        </div>
      </SectionCard>

      {/* ---- Restore points ---- */}
      <SectionCard icon={History} title="Restore points" desc="One-click snapshots stored on the server. Create one before big changes, roll back in seconds — no file juggling.">
        <button
          onClick={() => void createPoint()}
          disabled={creating}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Capture restore point now
        </button>

        <div className="mt-3 space-y-2">
          {backups !== null && backups.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No restore points yet — capture the first one above.</p>
          )}
          {backups?.map((b) => (
            <div key={b.file} className={`rounded-xl border p-3.5 ${pointConfirm === b.file ? "border-red-500/50 bg-red-500/5" : "border-border bg-secondary/30"}`}>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 rounded-lg bg-secondary flex items-center justify-center">
                  <Archive className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate font-mono">{b.file}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtWhen(b.createdAt)} · {fmtBytes(b.size)} · {b.rows} rows</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={`/api/dev/backups/download?file=${encodeURIComponent(b.file)}`}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent transition-colors"
                    title="Download this restore point"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={() => void deletePoint(b.file)}
                    disabled={busyFile === b.file}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent transition-colors text-muted-foreground hover:text-red-400"
                    title="Delete this restore point"
                  >
                    {busyFile === b.file ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {pointConfirm === b.file && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={pointConfirm}
                    readOnly
                    className="min-w-0 flex-1 rounded-lg border border-red-500/40 bg-background px-3 py-2 text-sm font-mono"
                  />
                  <button
                    onClick={() => void restorePoint(b.file)}
                    disabled={busyFile === b.file}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    Confirm rollback
                  </button>
                  <button
                    onClick={() => setPointConfirm("")}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {pointConfirm !== b.file && (
                <button
                  onClick={() => setPointConfirm(b.file)}
                  disabled={busyFile === b.file}
                  className="mt-2 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-500 hover:bg-amber-500/20 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <HardDriveDownload className="h-3.5 w-3.5" />
                  Roll the database back to this point
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Rolling back replaces the ENTIRE database with the snapshot — current data is lost. Everyone is signed out except you.</p>
      </SectionCard>

      {/* ---- File restore ---- */}
      <SectionCard icon={Upload} title="Restore from a downloaded file" desc="Brought a snapshot from your own laptop? Restore it here. Replaces the ENTIRE database (all current data is lost).">
        <div className="grid md:grid-cols-[1fr_150px_auto] gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-semibold"
          />
          <input
            type="text"
            value={restoreConfirm}
            onChange={(e) => setRestoreConfirm(e.target.value)}
            placeholder='Type "RESTORE"'
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={() => void doRestore()}
            disabled={!restoreFile || restoreConfirm !== "RESTORE"}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Restore
          </button>
        </div>
      </SectionCard>

      {/* ---- Danger zone ---- */}
      <SectionCard icon={Factory} title="Reset software data" desc="Danger zone. Capture a restore point first - a reset cannot be undone." tone="danger">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-semibold">Clear activity data</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Wipes status logs, work orders, downtime records and escalations. Machines, components, spares and all accounts stay.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={clearConfirm}
                onChange={(e) => setClearConfirm(e.target.value)}
                placeholder='Type "CLEAR"'
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={() => void doReset("activity")}
                disabled={clearConfirm !== "CLEAR"}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
            <p className="text-sm font-semibold text-red-400">Factory reset</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Wipes EVERYTHING: machines, departments, spares, work orders, logs and all artisan accounts. Only engineer accounts and the company identity survive.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder='Type "RESET"'
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={() => void doReset("factory")}
                disabled={resetConfirm !== "RESET"}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

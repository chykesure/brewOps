"use client";

import { useRef, useState } from "react";
import { PICKER_ORDER, STATUS_META, fmtTime } from "@/lib/status";
import { ALERTING_STATUSES, ESCALATION_META, type ComponentDTO, type EscalationCategory, type Status } from "@/lib/types";
import { logStatus, uploadPhoto, createEscalation } from "@/lib/client-api";
import { getPosition } from "@/lib/client-geo";
import { toast } from "sonner";
import { Camera, LoaderCircle, X, History as HistoryIcon, MapPin, Megaphone } from "lucide-react";

interface Props {
  component: ComponentDTO | null;
  machineCode?: string;
  canReport: boolean;
  onClose: () => void;
  onSaved: () => void;
  onOpenHistory?: (component: ComponentDTO) => void;
}

/**
 * Status picker modal — bottom sheet on mobile, centered dialog on desktop.
 * The card is a flex column with a fixed header; the body scrolls internally so
 * the action row is always reachable on short screens.
 */
export default function StatusPickerSheet({ component, machineCode, canReport, onClose, onSaved, onOpenHistory }: Props) {
  const [selected, setSelected] = useState<Status | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Escalate — flag the report for the Engineer's immediate attention (feedback loop)
  const [escalate, setEscalate] = useState(false);
  const [escCat, setEscCat] = useState<EscalationCategory>("CANNOT_FIX");

  if (!component) return null;
  const current = STATUS_META[component.currentStatus];
  const selectedIsAlerting = selected != null && (ALERTING_STATUSES as readonly string[]).includes(selected);

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(f);
      setPhoto(url);
      toast.success("Photo attached");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (!component || !selected) return;
    setSaving(true);
    try {
      // GPS on-site evidence — silently attached to the record, distance computed server-side
      const fix = await getPosition();
      await logStatus({
        componentId: component.id, status: selected,
        note: note.trim() || undefined, photo: photo ?? undefined,
        ...(fix ? { lat: fix.lat, lng: fix.lng } : {}),
      });
      // Feedback loop — the artisan asked for the Engineer to act on this report
      if (escalate && selectedIsAlerting) {
        await createEscalation({
          machineId: component.machineId, componentId: component.id,
          category: escCat,
          message: note.trim() || `${component.name} reported as ${STATUS_META[selected].label}, needs Engineer attention`,
          photo: photo ?? undefined,
        });
        toast.success("Status logged · Engineer notified", {
          description: `Escalation (${ESCALATION_META[escCat].label}) is on the Command Center with quick-fix actions`,
        });
      } else {
        toast.success(`${component.name} → ${STATUS_META[selected].label}`, {
          description: `Timestamped at ${fmtTime(new Date().toISOString())}${fix ? " · GPS stamped" : ""}`,
        });
      }
      setSelected(null);
      setNote("");
      setPhoto(null);
      setEscalate(false);
      setEscCat("CANNOT_FIX");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save status");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-6 animate-in fade-in-0 duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Report status · ${component.name}`}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border shadow-2xl max-h-[92dvh] sm:max-h-[86dvh] flex flex-col overflow-hidden text-left animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed header */}
        <div className="shrink-0 p-4 pb-2.5 border-b border-border/70">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight truncate">{component.name}</h2>
              <p className="text-xs mt-0.5 text-muted-foreground">
                {component.partCode ? `${component.partCode} · ` : ""}
                {machineCode}
                {component.lastLog
                  ? ` · last: ${STATUS_META[component.lastLog.status].label} ${fmtTime(component.lastLog.createdAt)}`
                  : " · no report yet today"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {onOpenHistory && (
                <button
                  onClick={() => onOpenHistory(component)}
                  className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="View history"
                >
                  <HistoryIcon className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Current:
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${current.badge}`}>
              <current.icon className="h-3 w-3" />
              {current.label}
            </span>
          </div>
        </div>

        {/* Scrollable body — the action row stays reachable on short screens */}
        {canReport ? (
          <div className="flex-1 min-h-0 overflow-y-auto brewops-scroll px-4 pt-3 pb-5 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {PICKER_ORDER.map((s) => {
                const meta = STATUS_META[s];
                const Icon = meta.icon;
                const active = selected === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelected(s)}
                    className={`h-[52px] rounded-xl border-2 flex items-center gap-2 px-3 text-left transition-all active:scale-[0.97] ${active ? meta.selected : "bg-background border-border hover:border-muted-foreground/50"}`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold leading-tight">{meta.label}</span>
                      <span className={`block text-[9px] leading-tight truncate ${active ? "opacity-70" : "text-muted-foreground"}`}>{meta.desc}</span>
                    </span>
                    {meta.alert && !active && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" title="Alerts the Engineer" />
                    )}
                  </button>
                );
              })}
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note: what did you see? (readings, leaks, noise…)"
              rows={2}
              className="w-full rounded-xl bg-background border border-input px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />

            {/* Escalate toggle — appears when an alerting status is picked */}
            {selectedIsAlerting && (
              <div className={`rounded-xl border p-3 space-y-2 transition-colors ${escalate ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-secondary/30"}`}>
                <button type="button" onClick={() => setEscalate((v) => !v)} className="w-full flex items-center gap-2.5 text-left">
                  <span
                    role="checkbox"
                    aria-checked={escalate}
                    className={`h-5 w-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${escalate ? "bg-amber-400 border-amber-400" : "border-muted-foreground/50 bg-background"}`}
                  >
                    {escalate && (
                      <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-none stroke-amber-950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4l2.5 2.5L9 1" /></svg>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-bold text-amber-300 flex items-center gap-1.5">
                      <Megaphone className="h-3.5 w-3.5" /> Escalate to the Engineer
                    </span>
                    <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">
                      Puts this on the Command Center with quick-fix &amp; reroute actions, not just in the log.
                    </span>
                  </span>
                </button>
                {escalate && (
                  <div className="flex gap-1.5 flex-wrap pt-0.5">
                    {(Object.keys(ESCALATION_META) as EscalationCategory[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEscCat(c)}
                        className={`h-8 px-2.5 rounded-lg border text-[10px] font-bold transition-colors ${
                          escCat === c
                            ? c === "SAFETY" ? "border-red-500/60 bg-red-500/15 text-red-300" : "border-amber-400/60 bg-amber-400/15 text-amber-300"
                            : "border-border bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {ESCALATION_META[c].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-11 px-4 rounded-xl border border-border bg-secondary flex items-center gap-2 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-60"
              >
                {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {photo ? "Photo attached ✓" : "Add photo"}
              </button>
              {photo && (
                <img src={photo} alt="Attached evidence" className="h-11 w-11 rounded-lg object-cover border border-border" />
              )}
              <button
                type="button"
                onClick={save}
                disabled={!selected || saving}
                className="ml-auto h-11 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-bold flex items-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-40"
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Log it
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center flex items-center justify-center gap-1">
              <MapPin className="h-3 w-3 text-emerald-400" /> GPS-stamped where available · red-dot statuses alert the Engineer instantly · your name & exact time are locked in
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto brewops-scroll px-4 py-8 text-sm text-muted-foreground text-center">
            Only the assigned artisan (or the Engineer) can update this component.
          </div>
        )}
      </div>
    </div>
  );
}

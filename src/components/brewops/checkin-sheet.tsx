"use client";

// CheckinSheet — the anti office-fraud gate. The artisan proves they are physically at
// the machine with ZERO printing involved: (1) one-tap GPS geofence check-in (primary),
// (2) typing the machine's registered nameplate number read off its metal plate (fallback
// when GPS can't get a fix indoors), or (3) optionally scanning a QR sticker for sites
// that print them. An optional live photo of the machine strengthens the record.
// Failed attempts are logged server-side — the Engineer sees every one of them.

import { useEffect, useRef, useState } from "react";
import { woCheckIn, uploadPhoto } from "@/lib/client-api";
import { getPosition, hasBarcodeDetector } from "@/lib/client-geo";
import { fmtDistance } from "@/lib/status";
import { toast } from "sonner";
import {
  X, QrCode, Keyboard, MapPin, LoaderCircle, ShieldCheck, ShieldAlert,
  ScanLine, CameraOff, ImagePlus, Navigation,
} from "lucide-react";

interface BarcodeDetectorLike {
  detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}

export default function CheckinSheet({
  woId, woCode, machineCode, machineName, open, onClose, onVerified,
}: {
  woId: string;
  woCode: string;
  machineCode: string;
  machineName: string;
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number | null } | null>(null);
  const [gpsState, setGpsState] = useState<"locating" | "ready" | "denied">("locating");
  const [scanning, setScanning] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [flagged, setFlagged] = useState<string[] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-hunt for a GPS fix when the sheet opens
  useEffect(() => {
    if (!open) return;
    let live = true;
    setGpsState("locating");
    getPosition(true).then((f) => {
      if (!live) return;
      if (f) { setGps({ lat: f.lat, lng: f.lng, acc: f.acc }); setGpsState("ready"); }
      else setGpsState("denied");
    });
    return () => { live = false; };
  }, [open]);

  const stopScan = () => {
    stopRef.current();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => stopScan, []); // cleanup on unmount
  useEffect(() => { if (!open) { stopScan(); setFlagged(null); setCode(""); setPhoto(null); setShowScan(false); } }, [open]);

  const pickPhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(file);
      setPhoto(url);
      toast.success("Machine photo attached to the check-in");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (payload: { method: string; code?: string; lat?: number; lng?: number; acc?: number | null }, label: string) => {
    setBusy(label);
    try {
      const res = await woCheckIn(woId, { ...payload, photo });
      if (res.result === "VERIFIED") {
        toast.success("Checked in at " + machineCode, {
          description: res.distanceM != null ? `GPS: ${fmtDistance(res.distanceM)} from the machine anchor` : label,
        });
        setFlagged(null);
        onVerified();
        onClose();
      } else {
        setFlagged(res.reasons ?? ["Evidence could not be verified"]);
        toast.error("Check-in flagged for review");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Check-in failed";
      setFlagged([msg]);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const startScan = async () => {
    if (!hasBarcodeDetector()) {
      toast.error("Live scanner is not available on this device. Type the machine's nameplate number instead");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setScanning(true);
      // wait a tick so the <video> mounts
      await new Promise((r) => setTimeout(r, 60));
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => null);
      }
      const Ctor = (window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
      }).BarcodeDetector;
      const detector = new Ctor!({ formats: ["qr_code"] });
      let stopped = false;
      stopRef.current = () => { stopped = true; };
      const tick = async () => {
        if (stopped || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          if (found.length > 0) {
            const raw = found[0].rawValue.trim();
            stopScan();
            await submit({ method: "QR", code: raw }, "QR scan");
            return;
          }
        } catch { /* frame not ready — keep scanning */ }
        setTimeout(tick, 250);
      };
      tick();
    } catch {
      setScanning(false);
      toast.error("Camera unavailable. Type the machine's nameplate number instead");
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-6 animate-in fade-in-0 duration-150"
      onClick={() => { stopScan(); onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Check in at ${machineCode}`}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-card border-t sm:border border-border shadow-2xl max-h-[92dvh] sm:max-h-[86dvh] flex flex-col overflow-hidden text-left animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 p-4 pb-2.5 border-b border-border/70">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-tight flex items-center gap-2">
                <Navigation className="h-4 w-4 text-primary shrink-0" /> Check in at machine
              </h2>
              <p className="text-xs mt-0.5 text-muted-foreground">
                {woCode} · {machineCode} {machineName}
              </p>
            </div>
            <button
              onClick={() => { stopScan(); onClose(); }}
              className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto brewops-scroll px-4 pt-3 pb-5 space-y-3.5">
            <p className="text-[11px] text-muted-foreground leading-relaxed rounded-xl bg-secondary/60 border border-border px-3 py-2.5">
              Prove you are standing at <b className="text-foreground">{machineCode}</b> before the checklist unlocks.
              Nothing to scan or print. Use your phone&apos;s GPS, or type the number registered from the machine&apos;s
              metal nameplate. Every attempt is stamped and audited.
            </p>

            {/* GPS status strip */}
            <div className="flex items-center gap-2 text-[11px]">
              {gpsState === "locating" && <><LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Getting your GPS position…</span></>}
              {gpsState === "ready" && <><MapPin className="h-3.5 w-3.5 text-emerald-400" /><span className="text-emerald-400">GPS ready{gps?.acc ? ` (±${Math.round(gps.acc)} m)` : ""}</span></>}
              {gpsState === "denied" && <><CameraOff className="h-3.5 w-3.5 text-amber-400" /><span className="text-amber-400">GPS unavailable · type the machine&apos;s nameplate number below</span></>}
            </div>

            {flagged && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5">
                <p className="text-[11px] font-bold text-red-400 flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> Check-in flagged · try again</p>
                <ul className="mt-1 space-y-0.5">
                  {flagged.map((f, i) => <li key={i} className="text-[11px] text-red-300/90 leading-snug">· {f}</li>)}
                </ul>
              </div>
            )}

            {/* HERO — one-tap GPS check-in */}
            <div className="space-y-1.5">
              <button
                onClick={() => gps && submit({ method: "GPS", lat: gps.lat, lng: gps.lng, acc: gps?.acc ?? null }, "GPS")}
                disabled={gpsState !== "ready" || busy !== null}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2.5 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {busy === "GPS" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <MapPin className="h-5 w-5" />}
                Check in with GPS · I&apos;m at the machine
              </button>
              <p className="text-[10px] text-muted-foreground text-center">
                One tap. The system compares your position with this machine&apos;s geofence. No scanning, no stickers.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">or type the nameplate number</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                placeholder="e.g. K7Q2MD"
                autoCapitalize="characters"
                autoComplete="off"
                inputMode="text"
                className="flex-1 min-w-0 h-14 rounded-2xl bg-background border border-input px-4 text-lg font-mono font-bold tracking-[0.3em] text-center uppercase outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={() => submit({ method: "CODE", code }, "Nameplate")}
                disabled={code.length < 4 || busy !== null}
                className="shrink-0 h-14 px-4 rounded-2xl bg-secondary border border-border text-sm font-bold flex items-center gap-2 hover:bg-accent disabled:opacity-40"
              >
                {busy === "Nameplate" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Keyboard className="h-4 w-4" />}
                Check in
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1.5">
              Read it off the metal nameplate riveted on <b className="text-foreground">{machineCode}</b>. The Engineer registered that number here.
            </p>

            {/* Optional live photo of the machine */}
            <div className="rounded-xl border border-border p-2.5 flex items-center gap-2.5">
              {photo ? (
                <>
                  <img src={photo} alt="Machine at check-in" className="h-12 w-12 rounded-lg object-cover border border-border" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Photo attached</p>
                    <button onClick={() => setPhoto(null)} className="text-[10px] text-muted-foreground underline hover:text-foreground">Remove</button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || busy !== null}
                    className="h-12 w-12 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0 hover:bg-accent disabled:opacity-50"
                    aria-label="Take a photo of the machine"
                  >
                    {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    <b className="text-foreground">Add a photo of the machine</b> (recommended): live camera only, stamped with your check-in. Helps when GPS is weak indoors.
                  </p>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* Optional QR sticker — only for sites that print tags */}
            {!showScan ? (
              <button
                onClick={() => setShowScan(true)}
                className="w-full h-9 rounded-xl border border-border text-[11px] font-semibold text-muted-foreground flex items-center justify-center gap-1.5 hover:text-foreground hover:bg-accent"
              >
                <QrCode className="h-3.5 w-3.5" /> Machine has a QR sticker? Scan it instead
              </button>
            ) : scanning ? (
              <div className="space-y-2">
                <div className="rounded-2xl overflow-hidden border-2 border-primary/50 relative">
                  <video ref={videoRef} className="w-full aspect-square object-cover bg-black" muted playsInline />
                  <div className="absolute inset-6 border-2 border-white/70 rounded-xl pointer-events-none" />
                  <div className="absolute bottom-2 inset-x-0 text-center">
                    <span className="rounded-full bg-black/70 px-3 py-1 text-[10px] font-bold text-white">Point at the QR sticker…</span>
                  </div>
                </div>
                <button onClick={stopScan} className="w-full h-10 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Cancel scan
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={startScan}
                  disabled={busy !== null}
                  className="flex-1 h-11 rounded-xl bg-primary/10 border border-primary/40 text-primary text-xs font-bold flex items-center justify-center gap-2 hover:bg-primary/20 disabled:opacity-50"
                >
                  <ScanLine className="h-4 w-4" /> Start camera scan
                </button>
                <button onClick={() => setShowScan(false)} className="h-11 px-4 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Hide
                </button>
              </div>
            )}

          <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400" />
            Why: work orders signed without on-site proof are flagged to the Engineer. This protects honest artisans too.
          </p>
        </div>
      </div>
    </div>
  );
}

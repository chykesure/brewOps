"use client";

// MachineTag — OPTIONAL printable sticker: QR code (encodes the machine's nameplate
// check-in code), the human-readable number under it, machine identity + functional
// location. Printing is entirely optional — artisans normally check in by GPS or by
// typing the nameplate number — but sites that want a physical tag can print this.

import { createPortal } from "react-dom";
import type { MachineDTO } from "@/lib/types";
import { X, Printer, RefreshCcw } from "lucide-react";
import { patchMachine } from "@/lib/client-api";
import { toast } from "sonner";
import { useState } from "react";

export default function MachineTag({
  machine, onClose, onChanged,
}: {
  machine: MachineDTO;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rotating, setRotating] = useState(false);
  if (typeof document === "undefined") return null;

  const rotate = async () => {
    setRotating(true);
    try {
      await patchMachine(machine.id, { rotateCode: true });
      toast.success("Code rotated. Old stickers stop working. Reprint only if you use stickers.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rotate failed");
    } finally {
      setRotating(false);
    }
  };

  return createPortal(
    <div className="tag-print-root fixed inset-0 z-[60] overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div className="tag-print-toolbar sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-[#17140f]/95 px-4 py-2.5 backdrop-blur print:hidden">
        <p className="text-xs font-semibold text-white/90">
          Optional QR sticker <span className="font-mono text-white/50">{machine.code}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={rotate}
            disabled={rotating}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/25 px-3 text-xs font-semibold text-white/85 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${rotating ? "animate-spin" : ""}`} /> Rotate code
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-[#111] hover:bg-white/90"
          >
            <Printer className="h-3.5 w-3.5" /> Print sticker
          </button>
          <button
            onClick={onClose}
            aria-label="Close tag"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 text-white/80 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sticker paper */}
      <div className="mx-auto my-6 w-[340px] rounded-lg bg-white p-5 text-[#111] shadow-2xl print:my-0 print:shadow-none print:rounded-none">
        <div className="flex items-center justify-between border-b-2 border-[#111] pb-2">
          <div>
            <p className="text-[11px] font-black tracking-tight">INTERNATIONAL BREWERIES PLC.</p>
            <p className="text-[8px] italic text-[#444]">Digital Work Order &amp; PM System</p>
          </div>
          <p className="text-[9px] font-bold uppercase tracking-wider rounded border border-[#111] px-1.5 py-0.5">Check-in Point</p>
        </div>

        <div className="mt-3 text-center">
          <p className="text-[22px] font-black leading-none tracking-tight">
            <span className="font-mono text-[13px] text-[#c2410c] align-top mr-1">{machine.code}</span>
            {machine.name}
          </p>
          {machine.functionalLoc && <p className="mt-0.5 font-mono text-[9px] text-[#555]">{machine.functionalLoc}</p>}
          {machine.location && <p className="text-[9px] text-[#555]">{machine.location}</p>}
        </div>

        <div className="mt-3 flex flex-col items-center">
          {/* QR image — served by the API, encodes the check-in code */}
          {machine.checkinCode ? (
             
            <img
              src={`/api/machines/${machine.id}/qr`}
              alt={`QR check-in code for ${machine.code}`}
              className="h-[210px] w-[210px]"
            />
          ) : (
            <div className="flex h-[210px] w-[210px] items-center justify-center border border-[#999] text-[10px] text-[#777] text-center px-4">
              No nameplate code yet. Set one in the machine editor first.
            </div>
          )}
          {machine.checkinCode && (
            <>
              <p className="mt-1 font-mono text-[26px] font-black tracking-[0.28em] leading-none">{machine.checkinCode}</p>
              <p className="text-[8.5px] text-[#555] mt-1">This number can also be typed manually in BrewOps. Printing stickers is optional</p>
            </>
          )}
        </div>

        <div className="mt-3 border-t border-[#333] pt-2 text-center">
          <p className="text-[9.5px] font-bold leading-snug">Optional · check in BEFORE starting any work order on this machine (GPS works without this sticker).</p>
          <p className="text-[8px] text-[#666] mt-0.5">Geofence radius {machine.geoRadiusM} m · GPS-stamped &amp; audited · Do not remove</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

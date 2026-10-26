"use client";

// Deterministic pseudo-barcode — same seed always renders the same bars + number,
// mirroring the barcode strips on the plant's printed SAP work orders.
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function barWidths(seed: string, count: number): number[] {
  let h = hashSeed(seed) || 123456789;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    out.push(1 + (h % 4));
  }
  return out;
}

export function barcodeNumber(seed: string, digits = 7): string {
  const n = hashSeed(seed) % Math.pow(10, digits);
  return String(n).padStart(digits, "0");
}

export default function WoBarcode({
  seed,
  height = 28,
  bars = 42,
  number = true,
  className = "",
}: {
  seed: string;
  height?: number;
  bars?: number;
  number?: boolean;
  className?: string;
}) {
  const widths = barWidths(seed, bars);
  const unit = 1.6;
  const gap = 1.2;
  const total = widths.reduce((a, w) => a + w * unit + gap, 0) - gap;
  const num = barcodeNumber(seed);
  return (
    <div className={`inline-flex flex-col items-end gap-0.5 ${className}`}>
      <svg width={total} height={height} viewBox={`0 0 ${total} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {widths.reduce<{ x: number; rects: React.ReactNode[] }>(
          (acc, w, i) => {
            const rects = [...acc.rects, <rect key={i} x={acc.x} y={0} width={w * unit} height={height} fill="#111" />];
            return { x: acc.x + w * unit + gap, rects };
          },
          { x: 0, rects: [] },
        ).rects}
      </svg>
      {number && <span className="text-[8px] leading-none tracking-[0.25em] text-[#333] font-mono">{num}</span>}
    </div>
  );
}

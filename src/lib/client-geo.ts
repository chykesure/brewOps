"use client";

// Browser geolocation with a short cache so we don't re-prompt on every step tick.
// Never throws — resolves null when GPS is unavailable/denied (the server decides what that means).

export interface Fix {
  lat: number;
  lng: number;
  acc: number | null;
  at: number;
}

const TTL_MS = 10 * 60_000;
let cached: Fix | null = null;
let inflight: Promise<Fix | null> | null = null;

export function cachedFix(): Fix | null {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  return null;
}

export function getPosition(force = false): Promise<Fix | null> {
  if (!force) {
    const c = cachedFix();
    if (c) return Promise.resolve(c);
  }
  if (inflight) return inflight;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  inflight = new Promise<Fix | null>((resolve) => {
    const done = (f: Fix | null) => {
      cached = f;
      inflight = null;
      resolve(f);
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy ?? null, at: Date.now() }),
      () => done(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  });
  return inflight;
}

/** True when the browser can decode barcodes in-page (Chrome/Edge on Android & desktop) */
export function hasBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

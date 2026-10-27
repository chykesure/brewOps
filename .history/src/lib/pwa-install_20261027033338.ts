"use client";

// Global PWA-install plumbing for BrewOps. The browser fires
// `beforeinstallprompt` at most once per page load (and only when the app is
// installable: https + valid manifest + service worker + not already
// installed). We capture it at module scope so ANY button on the page —
// engineer sidebar, artisan chrome, profile — can claim the same deferred
// prompt.
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function notify() {
  listeners.forEach((cb) => {
    try {
      cb(deferredPrompt !== null);
    } catch {
      // a broken listener must never break the others
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's default mini-infobar away — we own the UX
    deferredPrompt = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function installAvailable(): boolean {
  return deferredPrompt !== null;
}

export function onInstallAvailabilityChange(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function triggerNativeInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      deferredPrompt = null; // one-shot: the browser clears it after use anyway
      notify();
    }
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

/** True when the app already runs as an installed app (no install button then). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

/**
 * ANY iPhone / iPad browser — Safari, Chrome, Firefox, Edge on iOS… they all
 * run WebKit under Apple's rules, and NONE of them can install a PWA
 * programmatically. Every iOS browser must be routed to the manual
 * "Share → Add to Home Screen" guide; Chrome-on-iPhone getting the Android
 * ⋮-menu steps was the bug this check fixes.
 */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * iOS *Safari* specifically — the only iOS browser whose Share menu offers a
 * true standalone "Add to Home Screen". On Chrome/Firefox/Edge for iOS the
 * guide should first send the user to Safari.
 */
export function isIosSafari(): boolean {
  if (!isIos()) return false;
  return !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
}
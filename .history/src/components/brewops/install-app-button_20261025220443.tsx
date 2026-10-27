"use client";

// "Install BrewOps" button — shown on BOTH dashboards (engineer sidebar +
// mobile top bar, which artisan and engineer share). Behaviour:
//  · Chrome/Edge desktop & Android: fires the real browser install prompt.
//  · iPhone/iPad Safari: opens a short "Share → Add to Home Screen" guide.
//  · Already installed (standalone): renders nothing.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Download, Plus, Share, X } from "lucide-react";
import {
  installAvailable, isStandalone, isIosSafari, onInstallAvailabilityChange, triggerNativeInstall,
} from "@/lib/pwa-install";

export default function InstallAppButton({ variant }: { variant: "row" | "icon" }) {
  const [promptReady, setPromptReady] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [guide, setGuide] = useState<null | "ios" | "desktop">(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setStandalone(isStandalone());
    setPromptReady(installAvailable());
    const offEvt = onInstallAvailabilityChange((available) => setPromptReady(available));
    // React to the moment the user actually installs (display-mode flips).
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => setStandalone(isStandalone());
    mq.addEventListener?.("change", onMode);
    return () => {
      offEvt();
      mq.removeEventListener?.("change", onMode);
    };
  }, []);

  if (standalone) return null;

  const click = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (installAvailable()) {
        const outcome = await triggerNativeInstall();
        if (outcome === "accepted") {
          toast.success("Installing BrewOps… look for it on your home screen");
          setGuide(null);
        } else if (outcome === "dismissed") {
          toast("Install dismissed — the button stays right here", { icon: "ℹ️" });
        } else {
          setGuide(isIosSafari() ? "ios" : "desktop");
        }
      } else {
        setGuide(isIosSafari() ? "ios" : "desktop");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {variant === "row" ? (
        <button
          onClick={() => void click()}
          className="w-full rounded-xl border border-primary/30 bg-primary/10 p-3 flex items-center gap-3 hover:bg-primary/15 transition-colors text-left"
          aria-label="Install BrewOps as an app"
        >
          <span className="h-9 w-9 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <Download className="h-[18px] w-[18px] text-primary" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Install as app</span>
            <span className="block text-[10px] text-muted-foreground truncate">Home-screen icon, works like native</span>
          </span>
        </button>
      ) : (
        <button
          onClick={() => void click()}
          title="Install BrewOps as an app"
          aria-label="Install BrewOps as an app"
          className="h-9 w-9 rounded-full border border-border bg-secondary/80 flex items-center justify-center hover:bg-accent transition-colors shrink-0"
        >
          <Download className="h-4 w-4 text-primary" />
        </button>
      )}

      {guide && mounted && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setGuide(null)}
          role="dialog"
          aria-modal="true"
          aria-label="How to install BrewOps"
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-sm font-bold tracking-tight flex items-center gap-2">
                  <Download className="h-4 w-4 text-primary" /> Install BrewOps
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Two taps and BrewOps lives on your home screen — full screen, no browser bar.</p>
              </div>
              <button onClick={() => setGuide(null)} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {guide === "ios" ? (
              <ol className="space-y-3 text-[13px] leading-relaxed">
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-bold shrink-0 mt-0.5">1</span>
                  <span>Tap the <b>Share</b> button <Share className="inline h-4 w-4 text-primary -mt-0.5" /> at the bottom of Safari.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-bold shrink-0 mt-0.5">2</span>
                  <span>Scroll and choose <b>Add to Home Screen</b> <Plus className="inline h-4 w-4 text-primary -mt-0.5" />.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-bold shrink-0 mt-0.5">3</span>
                  <span>Tap <b>Add</b> — the BrewOps icon appears next to your apps.</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-[13px] leading-relaxed">
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-bold shrink-0 mt-0.5">1</span>
                  <span>Open your browser&apos;s <b>menu</b> (the <b>⋮</b> or <b>⋯</b> button, top-right).</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-bold shrink-0 mt-0.5">2</span>
                  <span>Choose <b>Install BrewOps</b> — or <b>Add to Home screen</b> on Android.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-bold shrink-0 mt-0.5">3</span>
                  <span>Confirm, and BrewOps opens like a native app from then on.</span>
                </li>
              </ol>
            )}

            <p className="mt-4 rounded-xl border border-border bg-secondary/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
              Your session, rounds and reports stay exactly as they are — installing only gives the app its own icon and window.
            </p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

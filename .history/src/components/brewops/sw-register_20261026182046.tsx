"use client";

// Registers the BrewOps service worker (public/sw.js) at the root scope.
// Mounted once in the root layout so EVERY page — login included — makes the
// app installable on Android/Chrome phones, not just the signed-in dashboards.
import { useEffect } from "react";

export default function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // a failed registration must never break the app — worst case the
        // phone falls back to the manual "Add to Home screen" guide
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
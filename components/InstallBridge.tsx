"use client";

import { useEffect } from "react";
import {
  clearInstallPrompt,
  markInstalled,
  setInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/install";

/**
 * The two browser events the install flow needs, wired once for the whole app.
 *
 * It renders nothing — it is mounted in the root layout purely so the listeners
 * outlive any screen that shows an install affordance:
 *
 *   - `beforeinstallprompt` fires once, early, and is worthless unless it is
 *     stashed (Chromium ignores `prompt()` outside a user gesture), so it is
 *     parked in lib/install for the nudge to replay.
 *   - `appinstalled` fires when the install completes, which retires the nudge
 *     for good — `display-mode: standalone` already covers the relaunch case.
 *
 * The service worker registration is here too: it has to run on every device,
 * not only the ones that will ever see a nudge, because having a fetch handler
 * is what makes the app installable in the first place.
 */
export function InstallBridge() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Failure is fine — an uninstallable app is degraded, never broken, and
      // the catch keeps a blocked registration out of the console.
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const onPrompt = (e: Event) => {
      // Chromium's own bar would show up on its own schedule; the nudge decides
      // the moment instead, so the default is suppressed here.
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      markInstalled();
      clearInstallPrompt();
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}

"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getInstallPrompt, getInstalled, subscribeInstall, promptInstall } from "@/lib/install";

const DISMISSED_KEY = "pemp.install.dismissed";

/**
 * The one-line install pitch for a phone visitor.
 *
 * It sits above the tab bar and asks for exactly one thing, because there is
 * only one thing worth asking for here. On Chromium it renders an Install button
 * backed by the parked `beforeinstallprompt`; on iOS Safari, which has no such
 * event, it falls back to naming the two taps it actually takes.
 *
 * It never appears when the app is already running installed — `display-mode:
 * standalone`, or `navigator.standalone` on iOS — and a dismissal is remembered
 * for good. An install prompt that keeps coming back after "no" is the reason
 * people learn to ignore them.
 */
export function InstallNudge() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);

  const prompt = useSyncExternalStore(subscribeInstall, getInstallPrompt, () => null);
  const installed = useSyncExternalStore(subscribeInstall, getInstalled, () => false);

  // Everything below reads `window`, so it is all deferred to the effect — the
  // phone shell is server-rendered and has to come out identical on the wire.
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    const alreadyDismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    setIos(isIos);
    setDismissed(alreadyDismissed || standalone);
    setReady(true);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode with storage off — the bar just reappears next load.
    }
  }, []);

  const install = useCallback(async () => {
    setBusy(true);
    const ok = await promptInstall();
    setBusy(false);
    if (ok) dismiss();
  }, [dismiss]);

  if (!ready || dismissed || installed) return null;
  // Android/Chromium: a real button. iOS: instructions, since there is no event.
  if (!prompt && !ios) return null;

  return (
    <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-black">Install Pemp</div>
        <div className="truncate text-[11px] text-muted">
          {prompt ? "Full screen, straight into the feed." : "Tap Share, then Add to Home Screen."}
        </div>
      </div>
      {prompt && (
        <button
          onClick={install}
          disabled={busy}
          className="press shrink-0 rounded-full burn-gradient px-3.5 py-2 text-[12px] font-black text-black disabled:opacity-60"
        >
          {busy ? "…" : "Install"}
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-3.5 w-3.5">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

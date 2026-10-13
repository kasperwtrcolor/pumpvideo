"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useIsDesktop } from "@/lib/use-desktop";
import { desktopReadable, getGateOpen, isShareRoute, subscribeGate } from "@/lib/mobile-gate";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { InstallNudge } from "./InstallNudge";
import { DesktopGate } from "./desktop/DesktopGate";
import { TopNav } from "./desktop/TopNav";

/**
 * The frame the app lives in — one child tree, four outcomes.
 *
 * The phone frame is what the server renders. On a desktop viewport the client
 * swaps before paint, so `children` is mounted exactly once and no page fetches
 * its data twice.
 *
 * Desktop is no longer a wide version of the app. Pemp is a vertical thumb feed
 * held in one hand, and the wide arrangement below the landing was a different
 * product that never read as this one, so it is gone. A desktop visitor now gets
 * one of three things:
 *
 *   - `/` and `/legal/*` — the wide shell, because the landing deck and the
 *     legal pages are the two things here written for a wide screen.
 *   - `/t/…` and `/u/…` — the phone feed, held in a centred 440px column. These
 *     are share targets, so a desktop click from X has to show the clip; but the
 *     phone feed stretched edge to edge is unreadable, so it keeps its phone
 *     width and the page around it says what it is. Trading inside them is
 *     already handled: `login()` raises the gate (see AuthBridge).
 *   - everything else — the mobile gate, whole-viewport, with nothing behind it.
 *
 * The gate is also raised as an overlay on `/` by the landing's own CTAs, which
 * is why the wide branch renders it conditionally rather than routing to it.
 *
 * The wide feed components are still in the tree — unreachable, not deleted — so
 * bringing a desktop layout back later is a routing change rather than a rewrite.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const desktop = useIsDesktop();
  const path = usePathname();
  const gate = useSyncExternalStore(subscribeGate, getGateOpen, () => false);

  if (desktop) {
    const share = isShareRoute(path);

    if (!share && !desktopReadable(path)) {
      return (
        <div className="flex h-dvh flex-col bg-bg text-ink">
          <DesktopGate />
        </div>
      );
    }

    return (
      <div className="flex h-dvh flex-col bg-bg text-ink">
        <TopNav />
        {share ? (
          // A phone-shaped column on a dark field, centred. The feed inside is
          // the same component a phone mounts — same swiper, same buy button,
          // same everything — it simply does not get to stretch.
          <main className="flex min-h-0 flex-1 justify-center bg-black/40">
            <div className="relative flex h-full w-full max-w-[440px] flex-col overflow-hidden border-x border-line bg-bg">
              {children}
            </div>
          </main>
        ) : (
          <main className="min-h-0 flex-1">{children}</main>
        )}
        {/* The landing's own CTAs raise the gate over the page rather than
            replacing it, so "back" on that screen is a real thing to offer. */}
        {gate && <DesktopGate dismissible />}
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-[440px] flex-col border-x border-line bg-bg">
      <AppHeader />
      <div className="min-h-0 flex-1">{children}</div>
      <InstallNudge />
      <BottomNav />
    </div>
  );
}

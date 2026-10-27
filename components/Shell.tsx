"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useIsDesktop } from "@/lib/use-desktop";
import { getGateOpen, isShareRoute, subscribeGate } from "@/lib/mobile-gate";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { InstallNudge } from "./InstallNudge";
import { DesktopGate } from "./desktop/DesktopGate";
import { TopNav } from "./desktop/TopNav";

/**
 * The frame the app lives in — one child tree, responsive chrome.
 *
 * The phone frame is what the server renders. On a desktop viewport the client
 * swaps before paint, so `children` is mounted exactly once and no page fetches
 * its data twice.
 *
 * Desktop visitors get:
 *   - The desktop top navigation with search, market ticker, and full page access.
 *   - Four-region layout on `/` (desktop feed), full desktop pages on app routes.
 *   - `/t/…` and `/u/…` share targets centered in a clean phone column.
 *   - An on-demand QR modal (DesktopGate) to easily scan and continue on mobile.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const desktop = useIsDesktop();
  const path = usePathname();
  const gate = useSyncExternalStore(subscribeGate, getGateOpen, () => false);

  if (desktop) {
    const share = isShareRoute(path);

    return (
      <div className="flex h-dvh flex-col bg-bg text-ink">
        <TopNav />
        {share ? (
          // A phone-shaped column on a dark field, centred. The feed inside is
          // the same component a phone mounts — same swiper, same buy button,
          // same everything — centered cleanly for shared permalinks.
          <main className="flex min-h-0 flex-1 justify-center bg-black/40">
            <div className="relative flex h-full w-full max-w-[440px] flex-col overflow-hidden border-x border-line bg-bg">
              {children}
            </div>
          </main>
        ) : (
          <main className="min-h-0 flex-1">{children}</main>
        )}
        {/* Mobile app promo / QR gate modal */}
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

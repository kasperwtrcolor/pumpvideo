"use client";

import { useIsDesktop } from "@/lib/use-desktop";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { TopNav } from "./desktop/TopNav";

/**
 * The frame the app lives in — one child tree, two chromes.
 *
 * The phone frame is what the server renders. On a desktop viewport the client
 * swaps to the wide shell (top nav, no bottom bar) before paint, so `children`
 * is mounted exactly once and no page fetches its data twice.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const desktop = useIsDesktop();

  if (desktop) {
    return (
      <div className="flex h-dvh flex-col bg-bg text-ink">
        <TopNav />
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-[440px] flex-col border-x border-line bg-bg">
      <AppHeader />
      <div className="min-h-0 flex-1">{children}</div>
      <BottomNav />
    </div>
  );
}

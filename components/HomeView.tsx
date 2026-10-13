"use client";

import { useSyncExternalStore } from "react";
import { Feed } from "./Feed";
import { Landing } from "./Landing";
import { DesktopLanding } from "./desktop/DesktopLanding";
import { getWelcomeOpen, subscribeWelcome } from "@/lib/welcome";
import { useIsDesktop } from "@/lib/use-desktop";
import type { LandingTile, LaunchTile } from "@/lib/landing";

/**
 * The home screen, per viewport.
 *
 * Phone: the swipe feed with the welcome overlay on top — exactly what shipped.
 *
 * Desktop: the landing deck, and nothing under it. `/` used to mount the wide
 * four-region feed behind the deck so that dismissing the landing revealed the
 * app; the app is a phone app now, so there is nothing to reveal — the deck *is*
 * `/`, and its CTAs raise the mobile gate instead of fading to a feed.
 */
export function HomeView({
  initialSolUsd,
  tiles,
  launches,
}: {
  initialSolUsd: number;
  tiles: LandingTile[];
  launches: LaunchTile[];
}) {
  const desktop = useIsDesktop();
  const open = useSyncExternalStore(subscribeWelcome, getWelcomeOpen, () => true);

  if (desktop) return <DesktopLanding tiles={tiles} launches={launches} />;

  return (
    <>
      <Feed initialSolUsd={initialSolUsd} />
      {open && <Landing tiles={tiles} launches={launches} />}
    </>
  );
}

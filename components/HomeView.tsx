"use client";

import { useSyncExternalStore } from "react";
import { Feed } from "./Feed";
import { Landing } from "./Landing";
import { DesktopFeed } from "./desktop/DesktopFeed";
import { DesktopLanding } from "./desktop/DesktopLanding";
import { getWelcomeOpen, subscribeWelcome } from "@/lib/welcome";
import { useIsDesktop } from "@/lib/use-desktop";
import type { LandingTile, LaunchTile } from "@/lib/landing";

/**
 * The home screen, per viewport.
 *
 * Phone: the swipe feed with the welcome overlay on top.
 * Desktop: the four-region desktop feed, with the desktop landing overlay over it.
 * Both read the same welcome store, so entering on either platform lands on the
 * feed and the landing closes.
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

  if (desktop) {
    return (
      <>
        <DesktopFeed />
        {open && <DesktopLanding tiles={tiles} launches={launches} />}
      </>
    );
  }

  return (
    <>
      <Feed initialSolUsd={initialSolUsd} />
      {open && <Landing tiles={tiles} launches={launches} />}
    </>
  );
}

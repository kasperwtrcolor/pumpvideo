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
 * Phone: the swipe feed with the welcome overlay on top — exactly what shipped.
 * Desktop: the four-region feed, with its own landing overlay over it. Both
 * read the same welcome store, so "open the app" on either platform lands on the
 * feed and the landing never reopens until a refresh.
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
      <Landing tiles={tiles} launches={launches} />
    </>
  );
}

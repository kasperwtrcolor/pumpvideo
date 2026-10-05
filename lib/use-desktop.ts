"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/**
 * True when the viewport is at the desktop breakpoint.
 *
 * The app is a phone app that grows a wide shell, so the server always renders
 * the phone layout and the client upgrades *before the browser paints*:
 * `useLayoutEffect` runs after hydration but ahead of paint, so a desktop
 * visitor never sees the 440px column flash and then jump.
 */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** 1024px — the point the feed's three rails actually fit side by side. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

export function useIsDesktop(query: string = DESKTOP_QUERY) {
  const [is, setIs] = useState(false);
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setIs(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [query]);
  return is;
}

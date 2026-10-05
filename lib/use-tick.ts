"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Flash a value that just moved.
 *
 * The CSS animations (`tick-up` / `tick-down`) tint an element for a moment and
 * return it to normal, so the flash reads as a tick rather than a state. Two
 * things are needed to replay one: a direction to colour it, and a changing
 * `nonce` to key the element on so React remounts it and the animation runs
 * again. Both come from here.
 *
 * A live number that silently changes is the single biggest reason a "live"
 * screen feels dead — the value is right but the movement, which is the whole
 * information, is invisible.
 */
export function useTick(value: number) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!Number.isFinite(value) || value === prev.current) return;
    setDir(value > prev.current ? "up" : "down");
    setNonce((n) => n + 1);
    prev.current = value;
    const t = setTimeout(() => setDir(null), 720);
    return () => clearTimeout(t);
  }, [value]);

  return { dir, nonce };
}

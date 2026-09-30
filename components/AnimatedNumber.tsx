"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A number that counts to its new value instead of jumping to it.
 *
 * On a swipe feed the price is the thing a viewer is trying to read, and a
 * number that simply appears tells them nothing about which way it went. This
 * animates from a *known* starting point to the current value, so the movement
 * itself carries the direction: up when the coin is up, down when it is down.
 *
 * `from` is the value to count from and `replayKey` is what triggers a replay —
 * the caller bumps it when a new clip arrives under the viewer. Between replays
 * the animation starts from wherever the number currently is, so a live tick
 * still counts rather than snapping.
 *
 * The easing is an expo-out: fast at first, then a long settle. That reads as a
 * counter spinning down than a linear tween, which looks like a loading bar.
 */
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function AnimatedNumber({
  value,
  from,
  format,
  duration = 720,
  replayKey,
  className,
}: {
  value: number;
  /** Starting point for a replay. Ignored if it is not finite. */
  from?: number;
  format: (n: number) => string;
  duration?: number;
  /** Change this to replay the count from `from`. */
  replayKey?: string | number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const raf = useRef<number | null>(null);
  const lastReplay = useRef(replayKey);

  const run = useCallback(
    (start: number, end: number) => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const v = start + (end - start) * easeOutExpo(p);
        shownRef.current = v;
        setShown(v);
        if (p < 1) {
          raf.current = requestAnimationFrame(step);
        } else {
          raf.current = null;
          shownRef.current = end;
          setShown(end);
        }
      };
      raf.current = requestAnimationFrame(step);
    },
    [duration],
  );

  useEffect(() => {
    const replaying = replayKey !== lastReplay.current;
    lastReplay.current = replayKey;
    const start = replaying && from != null && Number.isFinite(from) ? from : shownRef.current;
    // Nothing to animate (same value, or a replay that starts where it ends).
    if (start === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    run(start, value);
  }, [value, from, replayKey, run]);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return (
    <span className={className} aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}

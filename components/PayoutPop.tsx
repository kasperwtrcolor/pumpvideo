"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthBridge";
import { artUrl } from "@/lib/art-url";
import { fmtSol } from "@/lib/format";
import { setUnread } from "@/lib/unread";
import type { NotificationsResponse } from "@/lib/types";

/**
 * The payout pop.
 *
 * When someone buys a coin through one of your clips, your 1% settles on-chain
 * inside their swap — money arrives while you are looking at something else
 * entirely. `/api/trade/live/confirm` writes an `EARN` notification for it; this
 * is the other half: the app notices and says so.
 *
 * Two rules make it correct rather than annoying:
 *
 *   1. **Fire on the transition, not on render.** Payouts already in the inbox
 *      when you open the app are not news, so the first run adopts everything it
 *      can see and stays quiet. Only an id we have never seen pops. The seen set
 *      lives in localStorage, so a payout earned while you were away still pops
 *      once when you come back — but never twice.
 *   2. **One at a time, newest first.** A backlog collapses into a single pop:
 *      you get the most recent payout, not a queue of cards.
 *
 * Polling mirrors `NotifyBell`: paused while the tab is hidden, refetched on
 * return. It asks for a handful of rows rather than the bell's `limit=0` because
 * deciding what to announce needs the rows themselves, not just a count.
 */
const POLL_MS = 60_000;
const SEEN_KEY = "pemp.seenPayouts.v1";
const SEEDED_KEY = "pemp.seenPayouts.seeded.v1";
/** Beyond this the set is trimmed oldest-first; nobody is owed a pop that old. */
const SEEN_CAP = 200;
/** Keep in step with `payout-progress`'s duration in globals.css. */
const SHOW_MS = 5200;

/** Downward fan, in degrees — one dot per angle, spread by the `--a` custom prop. */
const PARTICLE_ANGLES = [-58, -36, -18, 0, 18, 36, 58];

type Payout = {
  id: string;
  amountSol: number;
  symbol: string | null;
  image: string | null;
  href: string;
};

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_CAP)));
  } catch {
    /* private mode — worst case a payout pops twice this session */
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Count up to the amount. The motion is the message here — a payout is a *number
 * arriving*, and a number that snaps into place is easy to miss. Under
 * `prefers-reduced-motion` it is simply the final value.
 */
function useCountUp(target: number): number {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? target : 0);

  useEffect(() => {
    if (reduced || target <= 0) {
      setShown(target);
      return;
    }
    let raf = 0;
    const started = performance.now();
    const DURATION = 900;
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / DURATION);
      // Decelerating, so it lands rather than stops.
      setShown(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else setShown(target);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  return shown;
}

function PayoutCard({ payout, onDismiss }: { payout: Payout; onDismiss: () => void }) {
  const shown = useCountUp(payout.amountSol);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[75] flex justify-center px-3 pt-3">
      <Link
        href={payout.href}
        onClick={onDismiss}
        role="status"
        aria-label={`You were paid ${fmtSol(payout.amountSol, 4)} SOL from ${
          payout.symbol ? `$${payout.symbol}` : "your clip"
        }`}
        className="payout-drop pointer-events-auto relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-up/40 bg-panel/95 p-3 shadow-2xl backdrop-blur-xl"
      >
        <span className="payout-halo" aria-hidden />

        {PARTICLE_ANGLES.map((a) => (
          <span
            key={a}
            aria-hidden
            className="payout-particle"
            style={{ "--a": `${a}deg` } as React.CSSProperties}
          />
        ))}

        <div className="relative flex items-center gap-3">
          <span className="payout-pop grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-up/40 bg-up/10">
            {payout.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={payout.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[13px] font-black text-up">SOL</span>
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-widest text-up">
              You got paid
            </span>
            <span className="block text-lg font-black tabular-nums leading-tight" aria-hidden>
              +{fmtSol(shown, shown < 1 ? 4 : 3)} SOL
            </span>
            <span className="block truncate text-[11px] text-muted">
              someone bought ${payout.symbol ?? "your coin"} through your clip
            </span>
          </span>

          <span className="shrink-0 text-[11px] font-bold text-up">View →</span>
        </div>

        <span className="payout-progress absolute inset-x-0 bottom-0 h-0.5 bg-up/70" aria-hidden />
      </Link>
    </div>
  );
}

export function PayoutPop() {
  const { authenticated, getToken } = useAuth();
  const [payout, setPayout] = useState<Payout | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const dismiss = useCallback(() => setPayout(null), []);

  const load = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch("/api/notifications?limit=12", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) return;
      const j = (await r.json()) as NotificationsResponse;

      // The same rows the bell counts, so publish the count it would have
      // reported — one fewer endpoint the badge has to poll on its own.
      setUnread(j.unread ?? 0);

      if (!seen.current) seen.current = readSeen();
      const earns = (j.notifications ?? []).filter((n) => n.type === "EARN");

      let seeded = true;
      try {
        seeded = window.localStorage.getItem(SEEDED_KEY) === "1";
      } catch {
        /* storage blocked — treat as seeded so we never fire a backlog */
      }

      if (!seeded) {
        // First run on this device: everything visible is history, not news.
        for (const n of earns) seen.current.add(n.id);
        writeSeen(seen.current);
        try {
          window.localStorage.setItem(SEEDED_KEY, "1");
        } catch {
          /* nothing to persist */
        }
        return;
      }

      const fresh = earns.filter((n) => !seen.current!.has(n.id));
      if (fresh.length === 0) return;

      // Rows arrive newest-first, so the head is the payout to announce.
      const latest = fresh[0];
      for (const n of fresh) seen.current.add(n.id);
      writeSeen(seen.current);

      setPayout({
        id: latest.id,
        amountSol: latest.amountSol ?? 0,
        symbol: latest.coinSymbol,
        image: latest.clipThumb ?? artUrl(latest.coinImage) ?? null,
        href: latest.coinSymbol
          ? `/coin/${encodeURIComponent(latest.coinSymbol)}`
          : "/notifications",
      });
    } catch {
      /* a missed poll is not worth surfacing */
    }
  }, [authenticated, getToken]);

  useEffect(() => {
    if (!authenticated) {
      setPayout(null);
      return;
    }
    void load();

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void load();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authenticated, load]);

  // Auto-dismiss. Keyed on the payout, so a newer one restarts the clock rather
  // than inheriting the tail of the previous one's.
  useEffect(() => {
    if (!payout) return;
    const t = setTimeout(() => setPayout(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [payout]);

  if (!payout) return null;

  // Keyed on the id: a different payout remounts the card, so the drop, the
  // coins and the counter all replay — and the counter starts from zero instead
  // of inheriting the previous amount.
  return <PayoutCard key={payout.id} payout={payout} onDismiss={dismiss} />;
}

"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "./AuthBridge";
import type { LandingTile } from "@/lib/landing";
import { getWelcomeOpen, setWelcomeOpen, subscribeWelcome } from "@/lib/welcome";
import { PersonIcon } from "./Icons";

/**
 * The welcome screen — the first thing a signed-out visitor sees, and the thing
 * a signed-out viewer is sent back to every few clips.
 *
 * A wall of live coin art drifting past the viewport, with the pitch and a
 * single decision: log in, or just watch.
 *
 * The artwork arrives already assembled (see lib/landing.ts) because it has to
 * be in the first paint; fetching it here would show gradients first and real
 * tokens a moment later. This component only decides what happens next.
 *
 * Whether it is open lives in lib/welcome.ts rather than in local state,
 * because the feed reopens it at the watch milestone and has no other way to
 * reach in here.
 */

/** Columns in the mosaic, and how long each takes to scroll a full loop. */
const COLUMNS: { dir: "up" | "down"; seconds: number }[] = [
  { dir: "up", seconds: 74 },
  { dir: "down", seconds: 92 },
  { dir: "up", seconds: 62 },
];

/**
 * Tiles per column, before duplication.
 *
 * Each column renders its tiles twice (see globals.css), so this also sets how
 * much art the wall needs: a column shorter than the viewport would leave a gap
 * as it scrolls. Nine square tiles comfortably overflows a phone screen.
 */
const PER_COLUMN = 9;

export function Landing({ tiles }: { tiles: LandingTile[] }) {
  const { authenticated, enabled, login } = useAuth();
  const open = useSyncExternalStore(subscribeWelcome, getWelcomeOpen, () => true);

  const columns = useMemo(() => {
    const cols: LandingTile[][] = COLUMNS.map(() => []);
    // Placeholders only when the catalogue came back empty — a designed wall
    // beats a black screen, and it is the one case where there is no real art to
    // show.
    const pool: LandingTile[] = tiles.length > 0 ? tiles : PLACEHOLDERS;
    for (let i = 0; i < COLUMNS.length * PER_COLUMN; i++) {
      cols[i % COLUMNS.length].push(pool[i % pool.length]);
    }
    return cols;
  }, [tiles]);

  const dismiss = useCallback(() => setWelcomeOpen(false), []);

  // `authenticated` short-circuits rather than being mirrored into state: signing
  // in is exactly what this screen asks for, so the moment it happens the screen
  // is done and disappears on the same render — no effect, no second pass.
  if (!open || authenticated) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-center bg-bg">
      {/* Same frame as the rest of the app. On a phone this is simply full-bleed,
          but on a desktop the app is a centred 440px column and a welcome screen
          spanning the whole monitor would look like a different product. */}
      <div className="relative h-full w-full max-w-[440px] overflow-hidden border-x border-line bg-bg">
        {/* The wall. Inert to touch and hidden from the accessibility tree: it is
            scenery, and a screen reader announcing sixty token names would bury
            the actual message. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid grid-cols-3 gap-1.5 p-1.5"
        >
          {columns.map((col, i) => (
            <div key={i} className="relative overflow-hidden">
              <div
                className={`flex flex-col gap-1.5 ${
                  COLUMNS[i].dir === "up" ? "mosaic-up" : "mosaic-down"
                }`}
                style={{ animationDuration: `${COLUMNS[i].seconds}s` }}
              >
                {/* Rendered twice: the duplicate is what the loop scrolls into. */}
                {[...col, ...col].map((tile, j) => (
                  <TileView key={j} tile={tile} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Two gradients. The first darkens the wall enough for the copy to hold
            contrast wherever it lands on it; the second pulls the eye to the
            buttons. */}
        <div className="absolute inset-0 bg-bg/45" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/85 to-bg/25" />

        <div className="relative flex h-full flex-col justify-end px-6 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] pt-10">
          <div className="rise-in flex items-center gap-2.5" style={{ animationDelay: "40ms" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={34} height={34} className="rounded-[10px]" />
            <span className="text-[15px] font-black tracking-[0.18em] text-ink">PEMP</span>
          </div>

          <h1
            className="rise-in mt-5 text-[44px] font-black uppercase leading-[0.92] tracking-[-0.02em] text-ink"
            style={{ animationDelay: "110ms" }}
          >
            Where clips <span className="text-accent">pay.</span>
          </h1>

          <p
            className="rise-in mt-3 max-w-[30ch] text-[13.5px] leading-relaxed text-muted"
            style={{ animationDelay: "180ms" }}
          >
            Every clip is a coin. Buy it straight from the video — and get paid 1% of
            every buy that comes through yours.
          </p>

          <div className="rise-in mt-6 space-y-2.5" style={{ animationDelay: "250ms" }}>
            {enabled ? (
              <button
                onClick={() => login()}
                className="burn-gradient flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-black tracking-wide text-black active:scale-[0.99]"
              >
                <PersonIcon className="h-5 w-5" />
                Login
              </button>
            ) : null}

            <button
              onClick={dismiss}
              className="w-full rounded-2xl border border-line bg-panel/80 py-4 text-[15px] font-bold text-ink backdrop-blur active:scale-[0.99]"
            >
              {enabled ? "Just watch" : "Watch clips"}
            </button>
          </div>

          <p
            className="rise-in mt-4 text-center text-[11px] leading-relaxed text-muted"
            style={{ animationDelay: "310ms" }}
          >
            {enabled
              ? "Email, Google or X. Pemp never holds your keys or your funds."
              : "Watch for free. Nothing to install."}
          </p>
        </div>
      </div>
    </div>
  );
}

function TileView({ tile }: { tile: LandingTile }) {
  return (
    // A gradient sits behind every tile: a lot of token art is a transparent PNG,
    // and a flat black panel around it reads as a failed image rather than a logo
    // on a card.
    <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-panel2 via-panel to-bg">
      {tile.video ? (
        <video
          src={tile.video}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : tile.art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tile.art}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-accent2/45 via-panel2 to-panel" />
      )}
    </div>
  );
}

/** Used only when the catalogue comes back empty. */
const PLACEHOLDERS: LandingTile[] = Array.from({ length: 6 }, () => ({
  art: null,
  video: null,
}));

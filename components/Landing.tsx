"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useAuth } from "./AuthBridge";
import type { LandingTile, LaunchTile } from "@/lib/landing";
import { getWelcomeOpen, setWelcomeOpen, subscribeWelcome } from "@/lib/welcome";
import { PersonIcon, RocketIcon, XIcon } from "./Icons";
import { LogoMark } from "./Logo";
import { MascotStack } from "./Mascots";
import { X_HANDLE, X_URL } from "@/lib/social";
import { fmtSol } from "@/lib/format";
import { Check, CoinChip, FeeRow, LaunchShowcase, Phone, Reveal, useLandingData } from "./landing/parts";

/**
 * The welcome screen — the first thing a signed-out visitor sees, and the thing
 * a signed-out viewer is sent back to every few clips.
 *
 * It opens on the wall: live coin art drifting past the viewport, the pitch, and
 * a single decision — log in, or just watch. Below that it unfolds into the same
 * story the wide arrangement tells — the feed, the coin, the buy, where a buy
 * goes — so someone who has never opened the app still knows exactly what it is
 * before they decide. The pieces are shared with the wide landing (see
 * components/landing/parts), so the two cannot drift apart.
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

/** The phone cycles through its clips on a timer — there is no scroll stage here. */
const REEL_MS = 4000;

export function Landing({ tiles, launches }: { tiles: LandingTile[]; launches: LaunchTile[] }) {
  const { authenticated, enabled, login } = useAuth();
  const open = useSyncExternalStore(subscribeWelcome, getWelcomeOpen, () => true);
  const { reels, slides, stats } = useLandingData(tiles);
  const [reelIdx, setReelIdx] = useState(0);

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

  // The wall is the one place the phone is not driven by a scroll, so a timer
  // advances it. Nothing moves under reduced-motion, so nothing is set up.
  useEffect(() => {
    if (slides.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setReelIdx((v) => (v + 1) % slides.length), REEL_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  const dismiss = useCallback(() => setWelcomeOpen(false), []);

  // `authenticated` short-circuits rather than being mirrored into state: signing
  // in is exactly what this screen asks for, so the moment it happens the screen
  // is done and disappears on the same render — no effect, no second pass.
  if (!open || authenticated) return null;

  // The film's copy, shared with the wide landing.
  const chip = reels[0] ?? slides[0];
  // The strip leads with anything that moves; it is rendered twice so the
  // marquee's -50% loop is seamless.
  const strip = [...tiles.filter((t) => t.video), ...tiles.filter((t) => !t.video)].slice(0, 18);

  return (
    <div className="no-scrollbar fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-bg">
      {/* Same frame as the rest of the app. On a phone this is simply full-bleed,
          but on a desktop the app is a centred 440px column and a welcome screen
          spanning the whole monitor would look like a different product. */}
      <div className="relative mx-auto w-full max-w-[440px] border-x border-line bg-bg">
        {/* ---- the wall: exactly one screen, as it always was ------------- */}
        <section className="hero-screen relative flex flex-col justify-end overflow-hidden px-6 pb-[calc(env(safe-area-inset-bottom)+1.75rem)] pt-10">
          {/* The wall. Inert to touch and hidden from the accessibility tree: it
              is scenery, and a screen reader announcing sixty token names would
              bury the actual message. */}
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

          <div className="relative">
            <div className="rise-in flex items-center gap-2.5" style={{ animationDelay: "40ms" }}>
              <LogoMark size={34} />
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

            {/* The community door: the mascots from the banner, and the one
                outbound link on this screen. */}
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Follow Pemp on X, ${X_HANDLE}`}
              className="rise-in mt-3 flex items-center justify-center gap-3 rounded-2xl border border-line bg-panel/70 py-3 text-[13px] font-bold text-ink active:scale-[0.99]"
              style={{ animationDelay: "300ms" }}
            >
              <MascotStack size={26} />
              <span className="flex items-center gap-1.5">
                <XIcon className="h-3.5 w-3.5" />
                Follow {X_HANDLE}
              </span>
            </a>

            <p
              className="rise-in mt-4 text-center text-[11px] leading-relaxed text-muted"
              style={{ animationDelay: "360ms" }}
            >
              {enabled
                ? "Email, Google or X. Pemp never holds your keys or your funds."
                : "Watch for free. Nothing to install."}
            </p>
          </div>
        </section>

        {/* ---- what it is, below the fold --------------------------------- */}

        <section className="border-t border-line px-6 py-14">
          <Reveal>
            <span className="deck-label">01 — The feed</span>
            <h2 className="mt-5 text-[clamp(28px,8vw,38px)] font-black leading-[0.98] tracking-tight">
              Swipe a wall of clips.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              A vertical feed ranked by what is actually moving. Watching is the whole
              interface — no tables, no charts to decode. Tap a clip to trade it, tap again
              to move on.
            </p>
          </Reveal>
          <Reveal delay={90} className="mt-9 flex justify-center">
            <Phone reels={slides} index={reelIdx} />
          </Reveal>
        </section>

        <section className="border-t border-line px-6 py-14">
          <Reveal>
            <span className="deck-label">02 — The coin</span>
            <h2 className="mt-5 text-[clamp(28px,8vw,38px)] font-black leading-[0.98] tracking-tight">
              Every clip has a <span className="text-accent">coin</span>.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              Each clip is bound to a token on Solana. The market cap, the move, the holders
              — all of it lives on the frame you are looking at.
            </p>
          </Reveal>
          {chip && (
            <Reveal delay={90}>
              <CoinChip reel={chip} />
            </Reveal>
          )}
        </section>

        <section className="border-t border-line px-6 py-14">
          <Reveal>
            <span className="deck-label">03 — The buy</span>
            <h2 className="mt-5 text-[clamp(28px,8vw,38px)] font-black leading-[0.98] tracking-tight">
              Buy from <span className="text-accent">the video</span>.
            </h2>
          </Reveal>
          <Reveal delay={90}>
            <ul className="mt-6 space-y-4">
              <Check>One tap builds the swap — amount, slippage and route, all filled in.</Check>
              <Check>Quoted on Jupiter, the deepest route Solana has.</Check>
              <Check>You sign it in your own wallet. Pemp never holds your keys or your funds.</Check>
            </ul>
          </Reveal>
        </section>

        <section className="border-t border-line px-6 py-14">
          <Reveal>
            <span className="deck-label">04 — Launch your own</span>
            <h2 className="mt-5 text-[clamp(28px,8vw,38px)] font-black leading-[0.98] tracking-tight">
              Or make <span className="text-accent">the coin</span>.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              Upload a video, give it a name, and it mints on-chain — the film becomes the
              coin&apos;s face. You pay the launch fee; the creator fee is yours on every trade.
            </p>
          </Reveal>
          <Reveal delay={90}>
            <LaunchShowcase launches={launches} />
          </Reveal>
          <Reveal delay={120} className="mt-5">
            <Link
              href="/launch"
              className="inline-flex items-center gap-2 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-[13px] font-black text-accent active:scale-[0.99]"
            >
              <RocketIcon className="h-4 w-4" />
              Launch a coin
            </Link>
          </Reveal>
        </section>

        <section className="border-t border-line px-6 py-14">
          <Reveal>
            <span className="deck-label">Where a buy goes</span>
            <h2 className="mt-5 text-[clamp(28px,8vw,38px)] font-black leading-[0.98] tracking-tight">
              Creators get <span className="text-accent">paid</span>.
            </h2>
          </Reveal>
          <Reveal delay={90}>
            <div className="mt-7 space-y-4">
              <FeeRow pct="97%" label="to the swap · you get the tokens" tone="ink" />
              <FeeRow pct="2%" label="app fee · keeps the lights on" tone="muted" />
              <FeeRow pct="1%" label="to the clip's creator · same transaction" tone="accent" />
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-5">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-wider text-muted">
                  paid to creators, on-chain
                </div>
                <div className="mt-1 text-[clamp(26px,9vw,38px)] font-black leading-none tabular-nums">
                  {stats ? `${fmtSol(stats.rewardsPaidSol)} SOL` : "—"}
                </div>
              </div>
              {chip?.symbol && (
                <span className="rounded-full bg-accent px-4 py-2 text-[13px] font-black text-black">
                  buy ${chip.symbol}
                </span>
              )}
            </div>
            <p className="mt-5 text-[12px] leading-relaxed text-muted">
              Settled to the creator's own wallet in the same transaction as the swap, not
              credited later. Memecoins are volatile and can go to zero.
            </p>
          </Reveal>
        </section>

        <section className="border-t border-line px-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] pt-14">
          <Reveal>
            <span className="deck-label">Pemp.fun</span>
            <h2 className="mt-5 text-[clamp(30px,9vw,42px)] font-black leading-[0.96] tracking-tight">
              Watch it. Buy it. <span className="text-accent">In one thumb.</span>
            </h2>
            <div className="mt-6 space-y-2.5">
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
          </Reveal>

          {strip.length > 0 && (
            <div className="marquee mt-10 -mx-6">
              <div className="marquee-track">
                {[...strip, ...strip].map((tile, i) => (
                  <div key={i} className="mx-1.5 w-20 shrink-0">
                    <TileView tile={tile} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-muted">
            <a href="/coins" className="hover:text-ink">
              Coins
            </a>
            <a href="/upload" className="hover:text-ink">
              Post a clip
            </a>
            <a href="/legal/terms" className="hover:text-ink">
              Terms
            </a>
            <a href="/legal/privacy" className="hover:text-ink">
              Privacy
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function TileView({ tile }: { tile: LandingTile }) {
  return (
    // A gradient sits behind every tile: a lot of token art is a transparent PNG,
    // and a flat black panel around it reads as a failed image rather than a logo
    // on a card. Square, because the wall is a grid of them and the strip sizes
    // them by width.
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

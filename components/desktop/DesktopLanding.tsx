"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { LandingTile } from "@/lib/landing";
import { getWelcomeOpen, setWelcomeOpen, subscribeWelcome } from "@/lib/welcome";
import { LogoLockup } from "../Logo";
import { MascotStack } from "../Mascots";
import { XIcon } from "../Icons";
import { X_HANDLE, X_URL } from "@/lib/social";
import { fmtCount, fmtSol } from "@/lib/format";
import { Check, CoinChip, FeeRow, Phone, Stat, useLandingData } from "../landing/parts";

/**
 * The desktop landing — the launch film, as a deck.
 *
 * One element per swipe: a wheel notch, a flick or an arrow key lands exactly on
 * the next panel. Two things move with the scroll rather than snapping between
 * states:
 *
 *   1. The copy drifts and fades as its panel enters and leaves — it rises to
 *      rest as the panel takes the screen and continues on its way as the next
 *      arrives.
 *   2. A single phone sits on a stage *behind* the scroller. It travels from one
 *      side to the other and swaps the clip it is playing, so advancing the deck
 *      feels like being handed a different device rather than scrolling past
 *      several.
 *
 * Both are driven from scroll position on rAF and are skipped entirely under
 * `prefers-reduced-motion`, where the deck becomes plain static panels and the
 * phone simply holds one side.
 *
 * Everything shown is the catalogue's own art and numbers — the reels inside the
 * phone and the coin chip are the tokens we are actually serving.
 */
export function DesktopLanding({ tiles }: { tiles: LandingTile[] }) {
  const open = useSyncExternalStore(subscribeWelcome, getWelcomeOpen, () => true);
  const enter = useCallback(() => setWelcomeOpen(false), []);
  const { reels, slides, stats } = useLandingData(tiles);
  const [reelIdx, setReelIdx] = useState(0);

  /* ---- the deck --------------------------------------------------------- */

  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const copyRefs = useRef<(HTMLDivElement | null)[]>([]);
  const frame = useRef(0);
  const reduce = useRef(false);
  const [active, setActive] = useState(0);

  /** Advance to a panel — the same move a wheel, swipe or key press makes. */
  const go = useCallback((i: number) => {
    const el = scroller.current?.querySelectorAll<HTMLElement>("[data-snap]")[i];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /**
   * Everything that answers the scroll, in one place.
   *
   * Panels are not all the same height, so dividing the scroll offset by the
   * viewport height mislabels the deck the moment one is taller than a screen.
   * Instead the continuous deck position `t` is interpolated between the two
   * panel start edges bracketing the scroll — `t = 3.4` means "40% of the way
   * from panel 3 to panel 4" — which stays honest whatever the panel heights.
   */
  const apply = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const panels = Array.from(el.querySelectorAll<HTMLElement>("[data-snap]"));
    if (panels.length === 0) return;
    const tops = panels.map((p) => p.offsetTop);
    const st = el.scrollTop;
    const last = panels.length - 1;

    let t = last;
    for (let i = 0; i < last; i++) {
      if (st <= tops[i + 1] || i === last - 1) {
        const span = Math.max(1, tops[i + 1] - tops[i]);
        t = i + (st - tops[i]) / span;
        break;
      }
    }
    t = Math.max(0, Math.min(last, t));
    // A resting panel should read exactly, not 0.98 of the way there: the snap
    // lands on start edges, so anything inside a hair of an integer is noise.
    const near = Math.round(t);
    if (Math.abs(t - near) < 0.02) t = near;
    setActive(near);

    // 1. the copy drifts up and fades as its panel leaves, and settles as it arrives
    const reduced = reduce.current;
    panels.forEach((_, i) => {
      const node = copyRefs.current[i];
      if (!node) return;
      if (reduced) {
        node.style.transform = "";
        node.style.opacity = "";
        return;
      }
      const lp = t - i;
      node.style.transform = `translate3d(${(lp * 26).toFixed(1)}px, ${(-lp * 34).toFixed(1)}px, 0)`;
      node.style.opacity = Math.max(0, Math.min(1, 1 - Math.abs(lp) * 1.15)).toFixed(3);
    });

    // 2. the phone travels across the stage and changes the clip it plays
    const st2 = stage.current;
    if (st2) {
      const side = sideAt(t);
      st2.style.transform = reduced ? "" : `translate3d(${(side * 20).toFixed(2)}%, 0, 0)`;
      st2.style.setProperty("--flip", side < 0 ? "-1" : "1");
      const n = slides.length;
      if (n > 0) {
        const idx = ((near % n) + n) % n;
        setReelIdx((v) => (v === idx ? v : idx));
      }
    }
  }, [slides.length]);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(apply);
  }, [apply]);

  // Keyboard is how a desktop reader actually drives a deck this shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(active + 1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        go(active - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, go]);

  // Reduced motion turns the whole layer off: static panels, phone parked right.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reduce.current = mq.matches;
      apply();
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [apply]);

  // Re-measure when the viewport changes, and once the reels land.
  useEffect(() => {
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [apply]);

  const register = useCallback(
    (i: number) => (el: HTMLDivElement | null) => {
      copyRefs.current[i] = el;
    },
    [],
  );

  if (!open) return null;

  const chip = reels[0] ?? slides[0];
  // The strip leads with anything that moves — a wall of stills is the wrong
  // first impression for a video product, and the catalogue's stills are many.
  const strip = [...tiles.filter((t) => t.video), ...tiles.filter((t) => !t.video)].slice(0, 28);

  return (
    <div className="landing landing-deck fixed inset-0 z-[100] flex flex-col text-ink">
      <div className="landing-grid" aria-hidden />

      {/* top bar */}
      <div className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-line/40 bg-black/20 px-5 backdrop-blur">
        <LogoLockup size={22} />
        <div className="flex items-center gap-2">
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Follow ${X_HANDLE} on X`}
            className="press flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel text-muted hover:text-ink"
          >
            <XIcon className="h-4 w-4" />
          </a>
          <button
            onClick={enter}
            className="press rounded-full burn-gradient px-4 py-2 text-[13px] font-black text-black"
          >
            Open the app
          </button>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {/* The one phone. It sits behind the scroller and is moved by scroll. */}
        <div ref={stage} className="phone-stage" aria-hidden>
          <Phone reels={slides} index={reelIdx} />
        </div>

        {/* One panel per swipe. `snap-y snap-mandatory` makes a wheel notch or a
            thumb flick land exactly on the next panel rather than halfway
            between two — the deck advances one element at a time. */}
        <div
          ref={scroller}
          onScroll={onScroll}
          className="no-scrollbar relative z-10 min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto"
        >
          {/* panel 1 — what it is */}
          <Panel index={0} side={1} ghost register={register}>
            <span className="deck-label">Pemp.fun — on Solana</span>
            <h1 className="mt-5 text-[clamp(34px,5.2vw,72px)] font-black leading-[0.92] tracking-[-0.03em]">
              Every clip is a{" "}
              <span className="text-sheen">coin</span> you can buy.
            </h1>
            <p className="mt-6 max-w-[44ch] text-[16px] leading-relaxed text-muted">
              A vertical feed where the video <em className="not-italic text-ink">is</em> the market.
              Swipe the wall and every clip carries its own coin — buy it straight from the frame with
              your own Solana wallet, and take 1% of every buy that comes through a clip you posted.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={enter}
                className="press rounded-2xl burn-gradient px-6 py-3.5 text-[15px] font-black tracking-wide text-black"
              >
                Open the feed
              </button>
              <button
                onClick={() => go(1)}
                className="press rounded-2xl border border-line bg-panel/70 px-6 py-3.5 text-[15px] font-bold text-ink hover:bg-panel2"
              >
                How it works
              </button>
            </div>
            {stats && (
              <div className="mt-7 flex flex-wrap gap-x-10 gap-y-3">
                <Stat label="coins" value={fmtCount(stats.coins)} />
                <Stat label="clips" value={fmtCount(stats.clips)} />
                <Stat label="traders" value={fmtCount(stats.traders)} />
                <Stat label="paid to creators" value={`${fmtSol(stats.rewardsPaidSol)} SOL`} />
              </div>
            )}
          </Panel>

          {/* panel 2 — the feed */}
          <Panel index={1} side={1} ghost register={register}>
            <span className="deck-label">01 — The feed</span>
            <h2 className="mt-5 text-[clamp(30px,4.2vw,58px)] font-black leading-[0.95] tracking-tight">
              Swipe a wall of clips.
            </h2>
            <p className="mt-5 max-w-[42ch] text-[16px] leading-relaxed text-muted">
              A vertical feed ranked by what is actually moving. Watching is the whole interface —
              no tables, no charts to decode. Tap a clip to trade it, tap again to move on.
            </p>
          </Panel>

          {/* panel 3 — the coin */}
          <Panel index={2} side={-1} ghost register={register}>
            <span className="deck-label">02 — The coin</span>
            <h2 className="mt-5 text-[clamp(30px,4.2vw,58px)] font-black leading-[0.95] tracking-tight">
              Every clip has a <span className="text-accent">coin</span>.
            </h2>
            <p className="mt-5 max-w-[42ch] text-[16px] leading-relaxed text-muted">
              Each clip is bound to a token on Solana. The market cap, the move, the holders — all of
              it lives on the frame you are looking at.
            </p>
            {chip && <CoinChip reel={chip} />}
          </Panel>

          {/* panel 4 — the buy */}
          <Panel index={3} side={1} ghost register={register}>
            <span className="deck-label">03 — The buy</span>
            <h2 className="mt-5 text-[clamp(30px,4.2vw,58px)] font-black leading-[0.95] tracking-tight">
              Buy from <span className="text-accent">the video</span>.
            </h2>
            <ul className="mt-6 space-y-4">
              <Check>One tap builds the swap — amount, slippage and route, all filled in.</Check>
              <Check>Quoted on Jupiter, the deepest route Solana has.</Check>
              <Check>
                You sign it in your own wallet. Pemp never holds your keys or your funds.
              </Check>
            </ul>
          </Panel>

          {/* panel 5 — where a buy goes */}
          <Panel index={4} side={-1} ghost register={register}>
            <span className="deck-label">Where a buy goes</span>
            <h2 className="mt-5 text-[clamp(30px,4.2vw,58px)] font-black leading-[0.95] tracking-tight">
              Creators get <span className="text-accent">paid</span>.
            </h2>
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
                <div className="mt-1 text-[clamp(26px,3vw,38px)] font-black leading-none tabular-nums">
                  {stats ? `${fmtSol(stats.rewardsPaidSol)} SOL` : "—"}
                </div>
              </div>
              {chip?.symbol && (
                <span className="rounded-full bg-accent px-4 py-2 text-[13px] font-black text-black">
                  buy ${chip.symbol}
                </span>
              )}
            </div>
            <p className="mt-5 text-[12px] text-muted">
              Settled to the creator's own wallet in the same transaction as the swap, not credited
              later. Memecoins are volatile and can go to zero.
            </p>
          </Panel>

          {/* panel 6 — close */}
          <Panel index={5} side={1} ghost={false} register={register}>
            <span className="deck-label">Pemp.fun</span>
            <h2 className="mt-5 text-[clamp(32px,4.6vw,62px)] font-black leading-[0.94] tracking-tight">
              Watch it. Buy it. <span className="text-accent">In one thumb.</span>
            </h2>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={enter}
                className="press rounded-2xl burn-gradient px-7 py-3.5 text-[15px] font-black tracking-wide text-black"
              >
                Start watching
              </button>
              <a
                href={X_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex items-center gap-2 rounded-2xl border border-line bg-panel/70 px-5 py-3.5 text-[14px] font-bold text-muted hover:text-ink"
              >
                <MascotStack size={22} />
                <XIcon className="h-3.5 w-3.5" /> Follow {X_HANDLE}
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-muted">
              <Link href="/coins" className="hover:text-ink">
                Coins
              </Link>
              <Link href="/upload" className="hover:text-ink">
                Post a clip
              </Link>
              <Link href="/legal/terms" className="hover:text-ink">
                Terms
              </Link>
              <Link href="/legal/privacy" className="hover:text-ink">
                Privacy
              </Link>
            </div>
            {tiles.length > 0 && (
              <div className="marquee mt-9 -mx-6 lg:-mx-16">
                <div className="marquee-track">
                  {[...strip, ...strip].map((tile, i) => (
                    <div
                      key={i}
                      className="mx-1.5 h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line bg-gradient-to-br from-panel2 via-panel to-bg"
                    >
                      {tile.video ? (
                        <video
                          src={tile.video}
                          muted
                          loop
                          autoPlay
                          playsInline
                          className="h-full w-full object-cover"
                        />
                      ) : tile.art ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={tile.art} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* The map of the deck: one tick per panel. Thin, because the panels label
          themselves — this is only for getting somewhere on purpose. */}
      <div className="pointer-events-none absolute bottom-0 right-5 top-14 z-20 hidden flex-col items-end justify-center gap-2.5 lg:flex">
        {SECTIONS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => go(i)}
            aria-label={`Go to ${s.label}`}
            aria-current={i === active}
            className={`pointer-events-auto h-px transition-all duration-300 ${
              i === active ? "w-8 bg-accent" : "w-4 bg-ink/25 hover:bg-ink/60"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

/** Which side of the stage each panel's phone holds: +1 right, -1 left. */
const SIDE = [1, 1, -1, 1, -1, 1] as const;

/** Interpolate the phone's side smoothly across the deck position. */
function sideAt(t: number): number {
  const i = Math.max(0, Math.min(SIDE.length - 1, Math.floor(t)));
  const j = Math.min(SIDE.length - 1, i + 1);
  const f = t - Math.floor(t);
  return SIDE[i] + (SIDE[j] - SIDE[i]) * f;
}

const SECTIONS = [
  { key: "what", label: "What it is" },
  { key: "feed", label: "The feed" },
  { key: "coin", label: "The coin" },
  { key: "buy", label: "The buy" },
  { key: "money", label: "Where a buy goes" },
  { key: "close", label: "Open" },
] as const;

/**
 * One panel of the deck: a ghost brand mark behind, and a text block the scroll
 * handler moves. Text rides the side of the stage the phone has just left.
 */
function Panel({
  index,
  side,
  ghost,
  register,
  children,
}: {
  index: number;
  side: number;
  ghost: boolean;
  register: (i: number) => (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      data-snap
      className="relative flex min-h-full snap-start items-center overflow-hidden px-6 py-14 lg:px-16"
    >
      {ghost && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo.png"
          alt=""
          aria-hidden
          className="deck-ghost"
          style={side > 0 ? { left: "7%" } : { right: "7%" }}
        />
      )}
      <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <div
          ref={register(index)}
          className={`deck-copy ${side < 0 ? "lg:col-start-2" : "lg:col-start-1"}`}
        >
          {children}
        </div>
      </div>
    </section>
  );
}



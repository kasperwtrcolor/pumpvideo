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
import type { FeedItemDTO } from "@/lib/types";

type Reel = { video: string | null; art: string | null; name: string; symbol: string; pct: number };

/**
 * The desktop landing.
 *
 * The product is a vertical video feed, so the landing shows one: a 3D phone on
 * a hero, its screen living-scrolling the app's own clips the way the real feed
 * does. Everything on the page is the catalogue's own art and numbers — the wall
 * behind the copy and the reels inside the phone are the tokens we are actually
 * serving, because a landing that lies about what the app is would be worse than
 * no landing.
 */
export function DesktopLanding({ tiles }: { tiles: LandingTile[] }) {
  const open = useSyncExternalStore(subscribeWelcome, getWelcomeOpen, () => true);
  const enter = useCallback(() => setWelcomeOpen(false), []);
  const [reels, setReels] = useState<Reel[]>([]);
  /** Videos the operator dropped into /public/landing (see the discovery effect). */
  const [provided, setProvided] = useState<string[]>([]);
  const [stats, setStats] = useState<{ coins: number; clips: number; traders: number; rewardsPaidSol: number } | null>(null);

  // The reels are the freshest clips the feed would serve — the same payload the
  // app renders, just shown to a visitor who has not opened it yet.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/feed?limit=6", { cache: "no-store" });
        const j = (await r.json()) as { items?: FeedItemDTO[] };
        if (!alive) return;
        const items = (j.items ?? []).filter((it) => it.videoUrl || it.coin.imageUrl);
        setReels(
          items.map((it) => ({
            video: it.videoUrl,
            art: it.coin.imageUrl,
            name: it.coin.name,
            symbol: it.coin.symbol,
            pct: it.coin.change24hPct,
          })),
        );
      } catch {
        /* the phone falls back to the wall's tiles below */
      }
    })();
    (async () => {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        const j = await r.json();
        if (alive) setStats(j);
      } catch {
        /* the stat strip simply hides */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Videos the operator supplied, from /public/landing.
   *
   * Two ways in, so dropping files in the repo needs no code change: a
   * `manifest.json` (an array, or `{ "videos": [...] }`) wins if it is there,
   * otherwise the convention is `1.mp4` … `6.mp4`. The convention is *probed*,
   * not assumed — a 404 is simply skipped, so a missing file never becomes a
   * broken frame on the hero.
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      let names: string[] = [];
      try {
        const r = await fetch("/landing/manifest.json", { cache: "no-store" });
        if (r.ok) {
          const j: unknown = await r.json();
          const list = Array.isArray(j)
            ? j
            : j && typeof j === "object" && Array.isArray((j as { videos?: unknown }).videos)
              ? (j as { videos: unknown[] }).videos
              : [];
          names = list.filter((x): x is string => typeof x === "string");
        }
      } catch {
        /* no manifest is the normal case */
      }
      if (names.length === 0) {
        const probed = await Promise.all(
          [1, 2, 3, 4, 5, 6].map(async (n) => {
            try {
              const r = await fetch(`/landing/${n}.mp4`, { method: "HEAD" });
              return r.ok ? `${n}.mp4` : null;
            } catch {
              return null;
            }
          }),
        );
        names = probed.filter((x): x is string => Boolean(x));
      }
      if (!alive || names.length === 0) return;
      setProvided(names.map((n) => (/^https?:\/\//.test(n) || n.startsWith("/") ? n : `/landing/${n}`)));
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---- the snap deck ---------------------------------------------------- */

  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  /** Advance to a section — the same move a wheel, swipe or key press makes. */
  const go = useCallback((i: number) => {
    const el = scroller.current?.querySelectorAll<HTMLElement>("[data-snap]")[i];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /** Which section is showing — the one whose start edge is nearest the scroll. */
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // Sections are not all the same height, so dividing the scroll offset by the
    // viewport height mislabels the deck the moment any section is taller than a
    // screen. Nearest start edge is the honest answer.
    let best = 0;
    let bestD = Infinity;
    el.querySelectorAll<HTMLElement>("[data-snap]").forEach((s, i) => {
      const d = Math.abs(s.offsetTop - el.scrollTop);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
  }, []);

  // Keyboard is how a desktop reader actually drives a deck this shape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
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

  // Supplied reels lead; the app's own freshest clips fill any room left. If
  // neither exists (a very fresh deploy), the welcome wall's art stands in so
  // the phone is never a blank slab.
  const fallback: Reel[] = tiles
    .slice(0, 6)
    .map((t) => ({ video: t.video, art: t.art, name: "Pemp", symbol: "", pct: 0 }));
  const supplied: Reel[] = provided.map((src) => ({
    video: src,
    art: null,
    name: "Pemp",
    symbol: "",
    pct: 0,
  }));
  const slides: Reel[] = (
    provided.length > 0 ? [...supplied, ...reels] : reels.length > 0 ? reels : fallback
  ).slice(0, 6);

  if (!open) return null;

  return (
    <div className="landing fixed inset-0 z-[100] flex flex-col bg-bg text-ink">
      {/* top bar */}
      <div className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-line/60 bg-bg/80 px-5 backdrop-blur">
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

      {/* hero */}
      {/* One section per swipe. `snap-y snap-mandatory` makes a wheel notch or
          a thumb flick land exactly on the next section rather than halfway
          between two — the deck advances one element at a time. */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="no-scrollbar relative min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto"
      >
      <section
        data-snap
        className="mx-auto grid min-h-full max-w-[1240px] snap-start grid-cols-1 items-center gap-8 px-6 pb-8 pt-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-10"
      >
        <div>
          <span className="riser inline-block rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-accent">
            Pemp · a clip is a coin
          </span>

          <h1 className="mt-5 text-[clamp(36px,5.6vw,76px)] font-black uppercase leading-[0.9] tracking-[-0.03em]">
            <span className="riser block" style={{ animationDelay: "40ms" }}>
              Every clip
            </span>
            <span className="riser block" style={{ animationDelay: "120ms" }}>
              is a coin
            </span>
            <span className="riser block text-sheen" style={{ animationDelay: "200ms" }}>
              you can buy.
            </span>
          </h1>

          <p
            className="riser mt-6 max-w-[46ch] text-[16px] leading-relaxed text-muted"
            style={{ animationDelay: "280ms" }}
          >
            A vertical feed where the video <em className="not-italic text-ink">is</em> the market.
            Swipe the wall, and every clip carries its own coin — buy it straight from the frame,
            with a custodial-free Solana wallet, and get paid 1% of every buy that comes through
            a clip you posted.
          </p>

          <div className="riser mt-6 flex flex-wrap items-center gap-3" style={{ animationDelay: "360ms" }}>
            <button
              onClick={enter}
              className="press rounded-2xl burn-gradient px-6 py-3.5 text-[15px] font-black tracking-wide text-black"
            >
              Open the feed
            </button>
            <button
              onClick={() => go(1)}
              className="press rounded-2xl border border-line bg-panel px-6 py-3.5 text-[15px] font-bold text-ink hover:bg-panel2"
            >
              How it works
            </button>
          </div>

          {stats && (
            <div className="riser mt-7 flex flex-wrap gap-x-10 gap-y-3" style={{ animationDelay: "440ms" }}>
              <Stat label="coins" value={fmtCount(stats.coins)} />
              <Stat label="clips" value={fmtCount(stats.clips)} />
              <Stat label="traders" value={fmtCount(stats.traders)} />
              <Stat label="paid to creators" value={`${fmtSol(stats.rewardsPaidSol)} SOL`} />
            </div>
          )}
        </div>

        <div className="flex justify-center">
          <Phone reels={slides} />
        </div>
      </section>

      {/* how it works */}
      <section
        id="how"
        data-snap
        className="flex min-h-full snap-start flex-col justify-center border-t border-line bg-panel/30 py-20"
      >
        <div className="mx-auto max-w-[1100px] px-6">
          <Reveal>
            <h2 className="text-[clamp(32px,4vw,56px)] font-black uppercase leading-[0.95] tracking-tight">
              Watch it. <span className="text-accent">Buy it.</span> In one thumb.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="h-full rounded-3xl border border-line bg-panel p-7">
                  <div className="text-[44px] font-black leading-none text-accent/30">{s.n}</div>
                  <h3 className="mt-4 text-[22px] font-black leading-tight">{s.title}</h3>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* the money */}
      <section
        data-snap
        className="flex min-h-full snap-start flex-col justify-center py-20"
      >
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 items-center gap-12 px-6 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-[clamp(32px,4vw,56px)] font-black uppercase leading-[0.95] tracking-tight">
              Creators get <span className="text-accent">paid.</span>
            </h2>
            <p className="mt-5 max-w-[48ch] text-[15px] leading-relaxed text-muted">
              Every buy carries a 2% app fee. When the buyer came through a clip, another{" "}
              <span className="font-bold text-ink">1% goes straight to whoever posted it</span> —
              settled to their own wallet in the same transaction as the swap, not credited later.
              The number below is summed from fees that actually moved on-chain.
            </p>
            <div className="mt-8 rounded-3xl border border-accent/40 bg-accent/10 p-6">
              <div className="text-[13px] font-bold uppercase tracking-wider text-accent">
                paid to creators, on-chain
              </div>
              <div className="mt-1 text-[clamp(36px,5vw,64px)] font-black leading-none tabular-nums">
                {stats ? `${fmtSol(stats.rewardsPaidSol)} SOL` : "—"}
              </div>
            </div>
            <p className="mt-4 text-[12px] text-muted">
              Memecoins are volatile and can go to zero. Pemp never holds your keys or your funds.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <div className="rounded-3xl border border-line bg-panel p-7">
              <div className="text-[13px] font-bold uppercase tracking-wider text-muted">
                where a buy goes
              </div>
              <div className="mt-5 space-y-4">
                <FeeRow pct="97%" label="to the swap · you get the tokens" tone="ink" />
                <FeeRow pct="2%" label="app fee · keeps the lights on" tone="muted" />
                <FeeRow pct="1%" label="to the clip's creator · same transaction" tone="accent" />
              </div>
              <div className="mt-6 border-t border-line pt-5 text-[13px] leading-relaxed text-muted">
                One tap builds the swap, quotes it on Jupiter, then <em className="not-italic text-ink">you</em>{" "}
                sign it in your wallet. The private key never leaves your device.
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* wall marquee */}
      <section
        data-snap
        className="flex min-h-full snap-start flex-col justify-center overflow-hidden border-t border-line py-16"
      >
        <Reveal>
          <h2 className="mb-8 text-center text-[13px] font-black uppercase tracking-[0.3em] text-muted">
            live on the wall right now
          </h2>
        </Reveal>
        <div className="marquee">
          <div className="marquee-track">
            {[...tiles, ...tiles].slice(0, 28).map((t, i) => (
              <div
                key={i}
                className="mx-1.5 h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-panel2 via-panel to-bg"
              >
                {t.video ? (
                  <video src={t.video} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                ) : t.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.art} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* final cta */}
      <section
        data-snap
        className="flex min-h-full snap-start flex-col justify-center border-t border-line py-24 text-center"
      >
        <Reveal>
          <h2 className="mx-auto max-w-[16ch] text-[clamp(36px,6vw,80px)] font-black uppercase leading-[0.92] tracking-tight">
            The feed is <span className="text-accent">open.</span>
          </h2>
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              onClick={enter}
              className="press rounded-2xl burn-gradient px-8 py-4 text-[16px] font-black tracking-wide text-black"
            >
              Start watching
            </button>
          </div>
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 text-[13px] font-bold text-muted hover:text-ink"
          >
            <MascotStack size={24} />
            <XIcon className="h-3.5 w-3.5" /> Follow {X_HANDLE}
          </a>
        </Reveal>
        <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] text-muted">
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
      </section>
      </div>

      {/* The map of the deck: a dot per section, plus the current label. Shown
          only on wide screens, where there is room beside the content. */}
      <div className="pointer-events-none absolute bottom-0 right-4 top-14 z-20 hidden flex-col items-center justify-center gap-2.5 xl:flex">
        {SECTIONS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => go(i)}
            aria-label={`Go to ${s.label}`}
            aria-current={i === active}
            className={`pointer-events-auto w-1.5 rounded-full transition-all ${
              i === active ? "h-7 bg-accent" : "h-1.5 bg-ink/25 hover:bg-ink/50"
            }`}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 text-[10px] font-black uppercase tracking-[0.3em] text-muted">
        {SECTIONS[active]?.label ?? ""}
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

/**
 * The deck, in order. Each entry is one section and one swipe, and the label is
 * what the progress marker reads out.
 */
const SECTIONS = [
  { key: "hero", label: "What it is" },
  { key: "how", label: "How it works" },
  { key: "money", label: "The money" },
  { key: "wall", label: "The wall" },
  { key: "open", label: "Open" },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Swipe a wall of clips",
    body: "A vertical feed of short videos, ranked by what is actually moving. Watching is the whole interface — no tables, no charts to decode.",
  },
  {
    n: "02",
    title: "Every clip has a coin",
    body: "Each clip is bound to a token on Solana. The market cap, the move, the holders — all of it lives on the frame you are looking at.",
  },
  {
    n: "03",
    title: "Buy from the video",
    body: "One tap quotes the swap and hands it to your own wallet to sign. Post your own clip and you take 1% of every buy that comes through it.",
  },
] as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[clamp(22px,2.4vw,30px)] font-black leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function FeeRow({ pct, label, tone }: { pct: string; label: string; tone: "ink" | "muted" | "accent" }) {
  const color = tone === "accent" ? "text-accent" : tone === "ink" ? "text-ink" : "text-muted";
  return (
    <div className="flex items-baseline gap-4">
      <span className={`w-[4.5rem] shrink-0 text-[28px] font-black leading-none tabular-nums ${color}`}>
        {pct}
      </span>
      <span className="text-[14px] leading-snug text-muted">{label}</span>
    </div>
  );
}

/** Reveal-on-scroll: adds `is-in` the first time the element enters the viewport. */
function Reveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`reveal ${shown ? "is-in" : ""}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * The 3D phone. A CSS perspective tilt holding a screen that auto-advances
 * through the reels on a loop — the feed's own gesture, performed for anyone who
 * has not opened it yet.
 */
function Phone({ reels }: { reels: Reel[] }) {
  const [i, setI] = useState(0);
  const n = Math.max(1, reels.length);

  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 3200);
    return () => clearInterval(t);
  }, [n]);

  return (
    <div className="phone-wrap relative">
      {/* A breathing halo, so the device reads as lit rather than pasted on. */}
      <div
        aria-hidden
        className="phone-glow pointer-events-none absolute -inset-10 rounded-[70px] bg-accent/20 blur-3xl"
      />
      <div className="phone">
        <div className="phone-screen">
          <div
            className="reel-track"
            style={{ transform: `translateY(-${i * 100}%)` }}
          >
            {reels.map((r, k) => (
              <div key={k} className="reel-slide">
                {r.video ? (
                  <video src={r.video} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                ) : r.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.art} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-accent2/40 via-panel2 to-panel" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <div className="text-[13px] font-black text-white text-glow">
                    {r.name}
                    {r.symbol ? <span className="text-white/60"> ${r.symbol}</span> : null}
                  </div>
                  {r.symbol ? (
                    <div
                      className={`mt-0.5 text-[11px] font-bold ${
                        r.pct >= 0 ? "text-up" : "text-down"
                      }`}
                    >
                      {r.pct >= 0 ? "↑" : "↓"} {Math.abs(r.pct).toFixed(1)}%
                    </div>
                  ) : null}
                </div>
                <div className="absolute bottom-24 right-2.5 flex flex-col gap-3">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-6 w-6 rounded-full border border-white/40 bg-black/30" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="phone-island" />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LandingTile, LaunchTile } from "@/lib/landing";
import type { FeedItemDTO } from "@/lib/types";
import { fmtPctAbs, fmtSol } from "@/lib/format";
import { RocketIcon } from "@/components/Icons";

/**
 * The pieces the landing shares between its phone and its wide arrangement.
 *
 * Both screens show the same story — the clips, the coin, the buy, the split —
 * out of the same catalogue data, so the parts that render it live here once
 * rather than being written twice and drifting apart.
 */

export type Reel = {
  video: string | null;
  art: string | null;
  name: string;
  symbol: string;
  pct: number;
  /** Market cap in SOL, as the app shows it. Zero when the coin has no market yet. */
  mc: number;
};

export type LandingStats = {
  coins: number;
  clips: number;
  traders: number;
  rewardsPaidSol: number;
};

/**
 * The landing's live data: the freshest clips the feed would serve, any clips
 * the operator dropped into `/public/landing`, and the headline counts.
 *
 * The supplied clips are discovered two ways so dropping files in the repo needs
 * no code change: a `manifest.json` (an array, or `{ "videos": [...] }`) wins if
 * it is there, otherwise the convention is `1.mp4` … `6.mp4`. The convention is
 * *probed*, not assumed — a 404 is simply skipped, so a missing file never
 * becomes a broken frame.
 */
export function useLandingData(tiles: LandingTile[]) {
  const [reels, setReels] = useState<Reel[]>([]);
  const [provided, setProvided] = useState<string[]>([]);
  const [stats, setStats] = useState<LandingStats | null>(null);

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
            mc: it.coin.marketCapSol,
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

  // Supplied reels lead; the app's own freshest clips fill any room left. If
  // neither exists (a very fresh deploy), the wall's art stands in so the phone
  // is never a blank slab.
  const fallback: Reel[] = tiles
    .slice(0, 6)
    .map((t) => ({ video: t.video, art: t.art, name: "Pemp", symbol: "", pct: 0, mc: 0 }));
  const supplied: Reel[] = provided.map((src) => ({
    video: src,
    art: null,
    name: "Pemp",
    symbol: "",
    pct: 0,
    mc: 0,
  }));
  const slides: Reel[] = (
    provided.length > 0 ? [...supplied, ...reels] : reels.length > 0 ? reels : fallback
  ).slice(0, 6);

  return { reels, slides, stats };
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[clamp(20px,2.2vw,28px)] font-black leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

export function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-black text-accent">
        ✓
      </span>
      <span className="text-[15px] leading-relaxed text-muted">{children}</span>
    </li>
  );
}

export function FeeRow({ pct, label, tone }: { pct: string; label: string; tone: "ink" | "muted" | "accent" }) {
  const color = tone === "accent" ? "text-accent" : tone === "ink" ? "text-ink" : "text-muted";
  return (
    <div className="flex items-baseline gap-4">
      <span className={`w-[4.5rem] shrink-0 text-[26px] font-black leading-none tabular-nums ${color}`}>
        {pct}
      </span>
      <span className="text-[14px] leading-snug text-muted">{label}</span>
    </div>
  );
}

/**
 * The token chip that rides beside the phone. Every number on it is real: the
 * coin's own symbol, market cap and 24h move, read from the same payload the
 * feed serves. The sparkline is ornament — it carries no scale, so it claims
 * nothing.
 */
export function CoinChip({ reel }: { reel: Reel }) {
  const up = reel.pct >= 0;
  const d = up
    ? "M2 30 L14 22 L24 26 L34 14 L46 18 L58 8 L70 12 L82 4"
    : "M2 6 L14 14 L24 10 L34 22 L46 18 L58 28 L70 24 L82 32";
  return (
    <div className="coin-chip mt-7 flex w-full max-w-[380px] items-center gap-4 p-5">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-black">{reel.name}</span>
          {reel.symbol && <span className="text-[13px] font-bold text-muted">${reel.symbol}</span>}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted">MC</span>
          <span className="text-[20px] font-black leading-none tabular-nums">
            {reel.mc > 0 ? `${fmtSol(reel.mc)} SOL` : "—"}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={`text-[15px] font-black tabular-nums ${up ? "text-up" : "text-down"}`}>
          {up ? "↑" : "↓"} {fmtPctAbs(reel.pct)}
        </span>
        <svg viewBox="0 0 84 36" className={`h-7 w-[84px] ${up ? "text-up" : "text-down"}`} aria-hidden>
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

/**
 * The 3D phone. A CSS perspective tilt holding the clip the landing is currently
 * showing. In the wide arrangement the travel between panels happens on a stage
 * behind it; on a phone it holds still and changes the clip on a timer, because
 * there is no second column to travel across.
 */
export function Phone({ reels, index }: { reels: Reel[]; index: number }) {
  const n = Math.max(1, reels.length);
  const i = ((index % n) + n) % n;
  const shown = reels.length > 0 ? reels : [null];

  return (
    <div className="phone-wrap relative">
      <div
        aria-hidden
        className="phone-glow pointer-events-none absolute -inset-10 rounded-[70px] bg-accent/20 blur-3xl"
      />
      <div className="phone">
        <div className="phone-screen">
          <div className="reel-track" style={{ transform: `translateY(-${i * 100}%)` }}>
            {shown.map((r, k) => (
              <div key={k} className="reel-slide">
                {r?.video ? (
                  <video src={r.video} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                ) : r?.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.art} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-accent2/40 via-panel2 to-panel" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
                {r?.name ? (
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <div className="text-[13px] font-black text-white text-glow">
                      {r.name}
                      {r.symbol ? <span className="text-white/60"> ${r.symbol}</span> : null}
                    </div>
                    {r.symbol ? (
                      <div className={`mt-0.5 text-[11px] font-bold ${r.pct >= 0 ? "text-up" : "text-down"}`}>
                        {r.pct >= 0 ? "↑" : "↓"} {fmtPctAbs(r.pct)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
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

/** `2m ago` / `3h ago` / `4d ago` from a millisecond age. */
function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * The coins launched *through* Pemp.
 *
 * A different claim from the rest of the landing: the wall and the strip show
 * what the app indexes, this shows what the app *makes*. So it never falls back
 * to placeholders — a made-up launch would be a lie about the one thing here
 * that is ours. An empty list renders an invitation instead, which is also the
 * honest state of a launchpad that nobody has used yet.
 *
 * A horizontal rail rather than a grid so the phone and the wide screen share
 * it: a few cards on a phone, a longer run on a desktop, same component.
 */
export function LaunchShowcase({ launches }: { launches: LaunchTile[] }) {
  if (launches.length === 0) {
    return (
      <div className="mt-7 rounded-2xl border border-dashed border-line bg-panel/60 px-5 py-9 text-center">
        <RocketIcon className="mx-auto h-9 w-9 text-accent" />
        <p className="mt-3 text-[15px] font-black tracking-tight">No coins launched yet.</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Drop a video, name it, and it goes on-chain in under a minute. Yours could be the
          first one here.
        </p>
        <Link
          href="/launch"
          className="burn-gradient mt-5 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-[13.5px] font-black tracking-wide text-black active:scale-[0.99]"
        >
          <RocketIcon className="h-4 w-4" />
          Launch a coin
        </Link>
      </div>
    );
  }

  return (
    <div className="no-scrollbar mt-7 flex snap-x gap-3 overflow-x-auto pb-1">
      {launches.map((l) => (
        <Link
          key={l.mint}
          href={`/t/${l.mint}`}
          className="group w-[148px] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-panel transition hover:border-accent/50"
        >
          <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-panel2 via-panel to-bg">
            {l.video ? (
              <video
                src={l.video}
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : l.art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.art}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-accent2/40 via-panel2 to-panel" />
            )}
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white/90 backdrop-blur">
              {ago(l.ageMs)}
            </span>
          </div>
          <div className="px-3 py-2.5">
            <div className="truncate text-[13px] font-black">${l.symbol}</div>
            <div className="truncate text-[11px] text-muted">{l.name}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** Reveal-on-scroll: adds `is-in` the first time the element enters the viewport. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
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
      className={`reveal ${shown ? "is-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItemDTO, FeedResponse } from "@/lib/types";
import { useTrader } from "./TraderProvider";
import { BuySheet } from "./BuySheet";
import {
  fmtCount,
  fmtPct,
  fmtPrice,
  fmtSol,
  fmtUsd,
  shortAddr,
  sym,
} from "@/lib/format";
import { CoinAvatar } from "./CoinAvatar";

type Sort = "hot" | "new" | "top";

const SORTS: { key: Sort; label: string }[] = [
  { key: "hot", label: "Hot" },
  { key: "new", label: "New" },
  { key: "top", label: "Top" },
];

export function Feed({ initialSolUsd }: { initialSolUsd: number }) {
  const { toast, refresh } = useTrader();

  const [sort, setSort] = useState<Sort>("hot");
  const [items, setItems] = useState<FeedItemDTO[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState(initialSolUsd);

  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (nextSort: Sort, nextOffset: number, replace: boolean) => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/feed?sort=${nextSort}&limit=10&offset=${nextOffset}`,
          { cache: "no-store" },
        );
        const j = (await r.json()) as FeedResponse;
        setSolUsd(j.solUsd || initialSolUsd);
        setItems((prev) => (replace ? j.items : [...prev, ...j.items]));
        setOffset(j.nextOffset);
        setHasMore(j.hasMore);
      } catch {
        toast("feed failed to load", "bad");
      } finally {
        setLoading(false);
      }
    },
    [initialSolUsd, toast],
  );

  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    setActive(0);
    void load(sort, 0, true);
  }, [sort, load]);

  // Pause everything but the clip in view; preload the neighbours.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const vid = el.querySelector("video");
          const idx = Number(el.dataset.index);
          if (!vid) continue;
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            setActive(idx);
            vid.play().catch(() => {});
          } else {
            vid.pause();
          }
        }
      },
      { root, threshold: [0, 0.6, 0.95] },
    );
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items.length]);

  // Prefetch the next page a screen before the end.
  useEffect(() => {
    if (hasMore && !loading && items.length > 0 && active >= items.length - 3) {
      void load(sort, offset, false);
    }
  }, [active, hasMore, loading, items.length, offset, sort, load]);

  const onFilled = useCallback(
    (idx: number, priceSol: number) => {
      setItems((prev) =>
        prev.map((it, i) =>
          i === idx ? { ...it, coin: { ...it.coin, priceSol } } : it,
        ),
      );
      void refresh();
    },
    [refresh],
  );

  const share = useCallback(
    async (it: FeedItemDTO) => {
      const url = `${window.location.origin}/coin/${it.coin.symbol}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: `$${it.coin.symbol}`, url });
        } else {
          await navigator.clipboard.writeText(url);
          toast("link copied");
        }
      } catch {
        /* user cancelled */
      }
    },
    [toast],
  );

  return (
    <div className="relative h-full">
      {/* sort rail */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center pt-3">
        <div className="pointer-events-auto flex gap-1 rounded-full border border-line glass p-1">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${
                sort === s.key ? "bg-ink text-black" : "text-muted hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setMuted((m) => !m)}
            title="toggle sound"
            className="rounded-full px-2.5 py-1 text-[11px] font-bold text-muted hover:text-ink"
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="snap-feed no-scrollbar h-full overflow-y-scroll"
      >
        {items.map((it, i) => (
          <ClipPanel
            key={it.id}
            item={it}
            index={i}
            muted={muted}
            liked={Boolean(liked[it.id])}
            solUsd={solUsd}
            onLike={() => setLiked((l) => ({ ...l, [it.id]: !l[it.id] }))}
            onBuy={() => setSheetIdx(i)}
            onShare={() => void share(it)}
          />
        ))}

        {items.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-lg font-bold">Nothing on the wall yet.</p>
            <p className="text-xs text-muted">
              Run <code className="rounded bg-panel2 px-1.5 py-0.5">npm run seed</code> to pull
              live pump.fun coins and render their clips.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex h-24 items-center justify-center text-xs text-muted">
            loading…
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="flex h-24 items-center justify-center text-xs text-muted">
            end of the wall · {items.length} clips
          </div>
        )}
      </div>

      {sheetIdx !== null && items[sheetIdx] && (
        <BuySheet
          coin={items[sheetIdx].coin}
          open
          onClose={() => setSheetIdx(null)}
          onFilled={({ priceSol }) => onFilled(sheetIdx, priceSol)}
        />
      )}
    </div>
  );
}

function ClipPanel({
  item,
  index,
  muted,
  liked,
  solUsd,
  onLike,
  onBuy,
  onShare,
}: {
  item: FeedItemDTO;
  index: number;
  muted: boolean;
  liked: boolean;
  solUsd: number;
  onLike: () => void;
  onBuy: () => void;
  onShare: () => void;
}) {
  const { coin } = item;
  const vid = useRef<HTMLVideoElement>(null);
  const up = coin.change24hPct >= 0;

  useEffect(() => {
    if (vid.current) vid.current.muted = muted;
  }, [muted]);

  return (
    <section
      data-index={index}
      className="snap-item relative h-full w-full overflow-hidden bg-black"
    >
      {/* thumbnail sits underneath so the panel is never blank while the file loads */}
      {item.thumbUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumbUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
      )}

      <video
        ref={vid}
        src={item.videoUrl}
        poster={item.thumbUrl ?? undefined}
        loop
        muted
        playsInline
        preload={index < 3 ? "auto" : "metadata"}
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-black/55" />

      {/* right rail */}
      <div className="absolute bottom-36 right-3 z-30 flex flex-col items-center gap-4">
        <RailButton
          label={sym(coin.symbol).slice(0, 5)}
          sub="coin"
          art={coin.imageUrl}
          symbol={coin.symbol}
          onClick={onBuy}
          ring
        />
        <RailButton
          label={fmtCount(item.likes + (liked ? 1 : 0))}
          sub="like"
          icon={liked ? "❤️" : "🤍"}
          onClick={onLike}
          active={liked}
        />
        <RailButton label={fmtCount(item.comments)} sub="chat" icon="💬" />
        <RailButton label={fmtCount(item.shares)} sub="share" icon="↗" onClick={onShare} />
        <RailButton
          label={fmtCount(item.views)}
          sub="views"
          icon="👁"
        />
      </div>

      {/* bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-30 space-y-3 p-4 pr-20">
        <div className="flex items-center gap-2 text-xs text-white/90 text-glow">
          <span className="font-bold">@{item.author ?? "unclaimed"}</span>
          <span className="text-white/50">·</span>
          <span className="text-white/60">{fmtCount(item.views)} views</span>
        </div>

        <p className="line-clamp-2 text-sm font-medium text-white/95 text-glow">
          {item.caption ?? `$${sym(coin.symbol)}`}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-black tracking-wide text-white">
            ${sym(coin.symbol)}
          </span>
          <span
            className={`rounded-md px-2 py-1 text-[11px] font-bold tabular-nums ${
              up ? "bg-up/20 text-up" : "bg-down/20 text-down"
            }`}
          >
            {fmtPct(coin.change24hPct)}
          </span>
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white/85 tabular-nums">
            MC {fmtSol(coin.marketCapSol)} SOL · {fmtUsd(coin.marketCapSol * solUsd)}
          </span>
          <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold text-white/85 tabular-nums">
            {fmtPrice(coin.priceSol)} SOL
          </span>
          {coin.complete && (
            <span className="rounded-md bg-accent/25 px-2 py-1 text-[11px] font-bold text-accent">
              graduated
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onBuy}
            className="burn-gradient flex-1 rounded-xl py-3 text-sm font-black tracking-wide text-black active:scale-[0.99]"
          >
            buy ${sym(coin.symbol)}
          </button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(coin.mint);
            }}
            title={coin.mint}
            className="rounded-xl border border-white/20 bg-black/45 px-3 py-3 text-[11px] font-semibold text-white/80"
          >
            {shortAddr(coin.mint, 3)}
          </button>
        </div>
      </div>
    </section>
  );
}

function RailButton({
  label,
  sub,
  icon,
  art,
  symbol,
  onClick,
  active,
  ring,
}: {
  label: string;
  sub: string;
  icon?: string;
  art?: string | null;
  symbol?: string;
  onClick?: () => void;
  active?: boolean;
  ring?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 text-white transition active:scale-95"
    >
      {art ? (
        <CoinAvatar
          src={art}
          symbol={symbol ?? label}
          className={`h-11 w-11 rounded-full ${
            ring ? "" : "border border-white/40"
          }`}
          ring={ring}
        />
      ) : (
        <span className={`text-2xl ${active ? "text-down" : ""}`}>{icon}</span>
      )}
      <span className="text-[10px] font-bold text-glow">{label}</span>
      <span className="text-[9px] uppercase tracking-wider text-white/50">{sub}</span>
    </button>
  );
}

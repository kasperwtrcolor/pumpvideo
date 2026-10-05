"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { FeedItemDTO } from "@/lib/types";
import { CoinAvatar } from "../CoinAvatar";
import { HeartIcon, CommentIcon, ShareIcon, VolumeIcon } from "../Icons";
import { fmtUsd, sym } from "@/lib/format";

/**
 * The centre stage: the vertical wall, one clip at a time.
 *
 * Same scroll model as the phone feed — a snap column the wheel drives — but
 * framed as a panel rather than full-bleed, because on desktop it shares the
 * page with the tape on its left and the trade panel on its right. The clip
 * that is centred *is* the selection: it drives the trade panel, exactly the way
 * the wide clip feeds work.
 */
export function ClipStage({
  items,
  active,
  onActive,
  muted,
  onToggleMute,
  liked,
  onLike,
  onComment,
  onShare,
  onBuy,
}: {
  items: FeedItemDTO[];
  active: number;
  onActive: (i: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  liked: Record<string, boolean>;
  onLike: (i: number) => void;
  onComment: (i: number) => void;
  onShare: (i: number) => void;
  onBuy: (i: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Recentre from the outside (a rail click swaps the wall) without fighting the
  // wheel: only jump when the wall itself changed.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [items]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
    if (i !== active) onActive(Math.max(0, Math.min(items.length - 1, i)));
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
        Nothing on the wall right now.
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 p-3">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="snap-feed no-scrollbar h-full overflow-y-scroll rounded-2xl border border-line bg-black"
      >
        {items.map((it, i) => (
          <Panel
            key={it.id}
            item={it}
            isActive={i === active}
            muted={muted}
            onToggleMute={onToggleMute}
            liked={Boolean(liked[it.id])}
            onLike={() => onLike(i)}
            onComment={() => onComment(i)}
            onShare={() => onShare(i)}
            onBuy={() => onBuy(i)}
          />
        ))}
      </div>
    </div>
  );
}

function Panel({
  item,
  isActive,
  muted,
  onToggleMute,
  liked,
  onLike,
  onComment,
  onShare,
  onBuy,
}: {
  item: FeedItemDTO;
  isActive: boolean;
  muted: boolean;
  onToggleMute: () => void;
  liked: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onBuy: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);

  // Play only the centred clip, and stop the rest — a wall of decoding videos is
  // the classic way a "live" feed melts a laptop.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (isActive) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [isActive]);

  const coin = item.coin;
  const up = coin.change24hPct >= 0;

  return (
    <div className="snap-item relative h-full w-full overflow-hidden bg-black">
      {item.videoUrl ? (
        <video
          ref={video}
          src={item.videoUrl}
          poster={item.thumbUrl ?? undefined}
          loop
          muted={muted}
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0">
          <CoinAvatar src={coin.imageUrl} symbol={coin.symbol} className="h-full w-full" />
          <div className="kenburns absolute inset-0">
            <CoinAvatar src={coin.imageUrl} symbol={coin.symbol} className="h-full w-full" />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25" />

      {/* media controls */}
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <button
          onClick={onToggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="press flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur"
        >
          <VolumeIcon muted={muted} className="h-4 w-4" />
        </button>
      </div>

      {/* action rail */}
      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4">
        <RailButton label="like" onClick={onLike} on={liked}>
          <HeartIcon filled={liked} className={`h-6 w-6 ${liked ? "text-down" : ""}`} />
        </RailButton>
        <RailButton label="comment" onClick={onComment}>
          <CommentIcon className="h-6 w-6" />
        </RailButton>
        <RailButton label="share" onClick={onShare}>
          <ShareIcon className="h-6 w-6" />
        </RailButton>
      </div>

      {/* caption + coin */}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
        <div className="min-w-0 flex-1">
          <Link href={`/t/${coin.mint}`} className="flex items-center gap-2">
            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-black/40">
              <CoinAvatar src={coin.imageUrl} symbol={coin.symbol} className="h-full w-full" />
            </span>
            <span className="truncate text-[15px] font-black text-white text-glow">
              {coin.name} <span className="text-white/60">${sym(coin.symbol)}</span>
            </span>
          </Link>
          {item.caption?.trim() && (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-white/85 text-glow">
              {item.caption.trim()}
            </p>
          )}
        </div>
        <button
          onClick={onBuy}
          className="press shrink-0 rounded-xl burn-gradient px-4 py-2.5 text-[13px] font-black text-black"
        >
          Buy ${sym(coin.symbol)}
          <span className={`ml-2 text-[11px] font-bold ${up ? "text-black/60" : "text-black/60"}`}>
            {fmtUsd(coin.marketCapSol)}
          </span>
        </button>
      </div>
    </div>
  );
}

function RailButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`press flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur ${
        on ? "border-down/40 bg-down/15 text-down" : "border-white/20 bg-black/40 text-white"
      }`}
    >
      {children}
    </button>
  );
}

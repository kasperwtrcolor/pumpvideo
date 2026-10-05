"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeedItemDTO, QuoteDTO } from "@/lib/types";
import { CoinRail } from "./CoinRail";
import { LiveTrades } from "./LiveTrades";
import { ClipStage } from "./ClipStage";
import { TradePanel } from "./TradePanel";
import { ShareSheet } from "../ShareSheet";
import { CommentSheet } from "../CommentSheet";
import { BuySheet } from "../BuySheet";
import { useTrader } from "../TraderProvider";
import { useAuth } from "../AuthBridge";

type Scope = "foryou" | "following";

/**
 * The desktop feed, four regions wide: the coin rail, the live tape, the stage
 * and the trade panel. The centred clip is the selection — everything to its
 * right describes it, which is the whole shape of the wide clip feeds and the
 * reason the phone's one-column wall needs a second arrangement at all.
 */
export function DesktopFeed() {
  const { toast } = useTrader();
  const { enabled, authenticated, getToken, login } = useAuth();

  const [scope, setScope] = useState<Scope>("foryou");
  /**
   * Which wall: what people posted, or the whole catalogue. The desktop default
   * is `uploaded` — a real video from a real person is the point of the feed,
   * and the catalogue's art-only rows are padding you should have to ask for.
   */
  const [source, setSource] = useState<"uploaded" | "all">("uploaded");
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItemDTO[]>([]);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  /** Live prices for the wall, refreshed on a timer so the numbers move. */
  const [quotes, setQuotes] = useState<Record<string, QuoteDTO>>({});
  const [shareFor, setShareFor] = useState<FeedItemDTO | null>(null);
  const [commentFor, setCommentFor] = useState<FeedItemDTO | null>(null);
  /** The clip whose coin is being traded — one sheet, opened from the stage or
   *  the panel, so there is exactly one place a swap can be built. */
  const [buyFor, setBuyFor] = useState<FeedItemDTO | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ limit: "24" });
      if (selectedMint) p.set("mint", selectedMint);
      if (scope === "following") p.set("scope", "following");
      if (source === "uploaded" && !selectedMint) p.set("uploaded", "1");
      const r = await fetch(`/api/feed?${p}`, { cache: "no-store" });
      const j = (await r.json()) as { items?: FeedItemDTO[] };
      const next = j.items ?? [];
      setItems(next);
      setActive(0);
      // A brand-new catalogue can have nothing uploaded yet. Rather than leave a
      // blank wall, fall back to everything — the toggle shows which one you got.
      if (next.length === 0 && source === "uploaded" && !selectedMint && scope === "foryou") {
        setSource("all");
      }
    } catch {
      /* leave the wall as it was */
    }
  }, [selectedMint, scope, source]);

  useEffect(() => {
    void load();
  }, [load]);

  // Seed like-state from the payload (the server knows what this viewer liked).
  useEffect(() => {
    setLiked((prev) => {
      const next = { ...prev };
      for (const it of items) if (it.likedByMe) next[it.id] = true;
      return next;
    });
  }, [items]);

  const activeItem = items[active] ?? null;

  /**
   * A live tick every few seconds, over whatever is on the wall.
   *
   * The market numbers on a clip are the reason the screen is interesting, so
   * they cannot be frozen at page-load. This is the same read-only price map the
   * phone feed polls; the returned quote is merged over the clip's stored coin
   * so the trade panel — and its tick flash — track the market rather than the
   * keeper's last write.
   */
  useEffect(() => {
    const mints = Array.from(new Set(items.map((it) => it.coin.mint).filter(Boolean)));
    if (mints.length === 0) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/quotes?mints=${encodeURIComponent(mints.join(","))}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as { quotes?: Record<string, QuoteDTO> };
        if (alive) setQuotes(j.quotes ?? {});
      } catch {
        /* a missed tick is not worth surfacing */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [items]);

  const liveQuote = activeItem ? quotes[activeItem.coin.mint] : undefined;
  const activeCoin = activeItem
    ? liveQuote
      ? {
          ...activeItem.coin,
          priceSol: liveQuote.priceSol,
          marketCapSol: liveQuote.marketCapSol,
          change24hPct: liveQuote.change24hPct,
        }
      : activeItem.coin
    : null;

  const onLike = useCallback(
    async (i: number) => {
      const it = items[i];
      if (!it) return;
      if (!enabled || !authenticated) {
        toast("Log in to like", "bad");
        return;
      }
      setLiked((m) => ({ ...m, [it.id]: !m[it.id] }));
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch(`/api/clips/${it.id}/like`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        const j = (await r.json()) as { liked?: boolean };
        if (r.ok && typeof j.liked === "boolean") {
          setLiked((m) => ({ ...m, [it.id]: j.liked as boolean }));
        }
      } catch {
        /* keep the optimistic state */
      }
    },
    [items, enabled, authenticated, getToken, toast],
  );

  return (
    <div className="flex h-full min-h-0 w-full">
      <CoinRail selectedMint={selectedMint} onSelect={setSelectedMint} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-2">
          {(
            [
              { key: "foryou", label: "For you" },
              { key: "following", label: "Following" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setScope(t.key)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-black transition ${
                scope === t.key ? "bg-ink text-black" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
          {selectedMint && (
            <button
              onClick={() => setSelectedMint(null)}
              className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-bold text-accent"
            >
              one coin · show all ✕
            </button>
          )}

          <div className="ml-auto flex items-center gap-1 rounded-full border border-line bg-panel p-0.5">
            {(
              [
                { key: "uploaded", label: "Clips" },
                { key: "all", label: "Everything" },
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                onClick={() => setSource(s.key)}
                title={
                  s.key === "uploaded"
                    ? "Only clips people actually posted"
                    : "The whole catalogue, including art-only tokens"
                }
                className={`rounded-full px-3 py-1 text-[12px] font-bold transition ${
                  source === s.key ? "bg-ink text-black" : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {scope === "following" && !authenticated && (
            <button
              onClick={login}
              className="rounded-full burn-gradient px-3.5 py-1.5 text-[12px] font-black text-black"
            >
              Log in to follow
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <LiveTrades />
          <ClipStage
            items={items}
            active={active}
            onActive={setActive}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            liked={liked}
            onLike={(i) => void onLike(i)}
            onComment={(i) => setCommentFor(items[i] ?? null)}
            onShare={(i) => setShareFor(items[i] ?? null)}
            onBuy={(i) => setBuyFor(items[i] ?? null)}
          />
        </div>
      </div>

      <TradePanel
        coin={activeCoin}
        onTrade={() => activeItem && setBuyFor(activeItem)}
      />

      {buyFor && (
        <BuySheet
          coin={buyFor.coin}
          clipId={buyFor.id}
          open
          onClose={() => setBuyFor(null)}
          onFilled={() => setBuyFor(null)}
        />
      )}

      {shareFor && (
        <ShareSheet
          clipId={shareFor.id}
          mint={shareFor.coin.mint}
          symbol={shareFor.coin.symbol}
          caption={shareFor.caption}
          videoUrl={shareFor.videoUrl}
          open
          onClose={() => setShareFor(null)}
        />
      )}

      {commentFor && (
        <CommentSheet
          clipId={commentFor.id}
          symbol={commentFor.coin.symbol}
          open
          onClose={() => setCommentFor(null)}
          onCount={() => {}}
        />
      )}
    </div>
  );
}

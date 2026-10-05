"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeedItemDTO } from "@/lib/types";
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
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [items, setItems] = useState<FeedItemDTO[]>([]);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
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
      const r = await fetch(`/api/feed?${p}`, { cache: "no-store" });
      const j = (await r.json()) as { items?: FeedItemDTO[] };
      setItems(j.items ?? []);
      setActive(0);
    } catch {
      /* leave the wall as it was */
    }
  }, [selectedMint, scope]);

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
          {scope === "following" && !authenticated && (
            <button
              onClick={login}
              className="ml-auto rounded-full burn-gradient px-3.5 py-1.5 text-[12px] font-black text-black"
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
        coin={activeItem?.coin ?? null}
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

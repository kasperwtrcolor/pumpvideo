"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { FeedItemDTO, FavoritesResponse, QuoteDTO, QuotesResponse } from "@/lib/types";
import { useAuth } from "@/components/AuthBridge";
import { useTrader } from "@/components/TraderProvider";
import { BuySheet } from "@/components/BuySheet";
import { CoinAvatar } from "@/components/CoinAvatar";
import { StarIcon } from "@/components/Icons";
import { CultureIcon } from "@/components/CultureIcon";
import { LiveDot } from "@/components/PriceTicker";
import { artUrl } from "@/lib/art-url";
import { fmtPct, fmtPrice, fmtSol, fmtUsd, sym } from "@/lib/format";

/**
 * Favourites — the clips you saved to come back to.
 *
 * This is the one screen whose job is to be *returned* to, so it is deliberately
 * a plain list rather than another swipe feed: you saved these to find them
 * again, not to watch them one at a time. Each row is a live quote with a buy
 * button, so acting on a save is one tap.
 */
export default function FavoritesPage() {
  const { solUsd } = useTrader();
  const { enabled: authEnabled, authenticated, login, getToken } = useAuth();

  const [items, setItems] = useState<FeedItemDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<FeedItemDTO | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteDTO>>({});

  const load = useCallback(async () => {
    if (!authenticated) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("session expired — log in again");
      const r = await fetch("/api/favorites?limit=50", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = (await r.json()) as Partial<FavoritesResponse> & { detail?: string };
      if (!r.ok) throw new Error(j.detail || "could not load your favourites");
      setItems(j.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authenticated, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live quotes for the saved coins, refreshed on a timer so the prices in the
  // list move without a reload. The list is bounded (one page), so one request
  // covers the whole screen.
  useEffect(() => {
    const mints = Array.from(new Set(items.map((it) => it.coin.mint)));
    if (mints.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/quotes?mints=${encodeURIComponent(mints.join(","))}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = (await r.json()) as QuotesResponse;
        if (!cancelled && j.quotes) setQuotes((q) => ({ ...q, ...j.quotes }));
      } catch {
        /* offline — keep the last known prices */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [items]);

  /** Unsave straight from the list. The row disappears because it is gone. */
  const unsave = useCallback(
    async (it: FeedItemDTO) => {
      const before = items;
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      try {
        const token = await getToken();
        if (!token) throw new Error("session expired — log in again");
        const r = await fetch(`/api/clips/${it.id}/favorite`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error("could not remove that");
      } catch (e) {
        setItems(before); // put it back rather than lie about what was saved
        setError((e as Error).message);
      }
    },
    [items, getToken],
  );

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-3 pb-24 pt-4">
        <h1 className="text-2xl font-black tracking-tight">Favourites</h1>
        <p className="mt-1 text-xs text-muted">
          Clips you saved to buy later. Quotes below are live.
        </p>

        {!authEnabled && (
          <Notice>
            Login is not configured on this deployment, so there is nowhere to keep
            favourites.
          </Notice>
        )}

        {authEnabled && !authenticated && (
          <div className="mt-6 rounded-2xl border border-line bg-panel p-5 text-center">
            <CultureIcon name="popcat" size={76} className="mx-auto" />
            <p className="mt-3 text-sm font-bold">Save clips as you scroll</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Log in and tap the star on any clip to keep it here — then come back and buy
              when you are ready.
            </p>
            <button
              onClick={login}
              className="burn-gradient mt-4 w-full rounded-xl py-3 text-sm font-black tracking-wide text-black active:scale-[0.99]"
            >
              Log in
            </button>
          </div>
        )}

        {authenticated && (
          <div className="mt-4 space-y-2">
            {error && (
              <div className="rounded-xl border border-down/40 bg-down/10 px-3 py-2 text-[11px] font-semibold text-down">
                {error}
              </div>
            )}

            {items.map((it) => (
              <FavoriteRow
                key={it.id}
                item={it}
                solUsd={solUsd}
                quote={quotes[it.coin.mint]}
                onBuy={() => setSheet(it)}
                onUnsave={() => void unsave(it)}
              />
            ))}

            {!loading && !error && items.length === 0 && (
              <div className="rounded-2xl border border-line bg-panel px-4 py-12 text-center">
                <CultureIcon name="wif" size={76} className="mx-auto" />
                <p className="mt-3 text-sm font-bold">Nothing saved yet</p>
                <p className="mt-1.5 text-[12px] text-muted">
                  Tap the star on a clip in{" "}
                  <Link href="/" className="text-accent">
                    the feed
                  </Link>{" "}
                  to keep it here.
                </p>
              </div>
            )}

            {loading && (
              <div className="px-3 py-10 text-center text-xs text-muted">loading…</div>
            )}
          </div>
        )}
      </div>

      {sheet && (
        <BuySheet
          coin={sheet.coin}
          clipId={sheet.id}
          open
          onClose={() => setSheet(null)}
          // A fill moves the price, so re-read the list rather than patch one row
          // and leave the rest of the quotes stale.
          onFilled={() => void load()}
        />
      )}
    </div>
  );
}

function FavoriteRow({
  item,
  solUsd,
  quote,
  onBuy,
  onUnsave,
}: {
  item: FeedItemDTO;
  solUsd: number;
  quote?: QuoteDTO;
  onBuy: () => void;
  onUnsave: () => void;
}) {
  const { coin } = item;
  const still = item.thumbUrl ?? artUrl(coin.imageUrl);

  const price = quote?.priceSol ?? coin.priceSol;
  const marketCap = quote?.marketCapSol ?? coin.marketCapSol;
  const change = quote?.change24hPct ?? coin.change24hPct;

  // Held? Then colour against the entry price, not the 24h move.
  const pos = item.position ?? null;
  const livePnlPct = pos && pos.entrySol > 0 ? ((price - pos.entrySol) / pos.entrySol) * 100 : null;
  const inProfit = pos ? price >= pos.entrySol : change >= 0;

  return (
    <div className="flex items-center gap-3 overflow-hidden rounded-2xl border border-line bg-panel p-2.5">
      {/* 9:16 preview — the clip if it exists, otherwise the coin art */}
      <div className="relative h-[92px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-panel2">
        {item.videoUrl ? (
          <video
            src={item.videoUrl}
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <CoinAvatar src={coin.imageUrl} symbol={coin.symbol} className="h-full w-full" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold">{coin.name}</span>
          <span className="text-[11px] text-muted">${sym(coin.symbol)}</span>
          {coin.complete && (
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold text-accent">
              GRAD
            </span>
          )}
        </div>

        {item.caption && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{item.caption}</p>
        )}

        <div className="mt-1.5 flex items-center gap-2 text-[11px] tabular-nums">
          <span className="font-bold">{fmtSol(marketCap)} SOL</span>
          <span className="text-white/40">·</span>
          <span className={inProfit ? "text-up" : "text-down"}>
            {fmtPrice(price)} SOL
            <LiveDot live={Boolean(quote?.live)} />
          </span>
          {solUsd > 0 && (
            <>
              <span className="text-white/40">·</span>
              <span className="text-muted">
                {fmtUsd(marketCap * solUsd)} cap
              </span>
            </>
          )}
        </div>

        <div className={`mt-0.5 text-[10px] font-bold tabular-nums ${inProfit ? "text-up" : "text-down"}`}>
          {pos
            ? `you ${livePnlPct != null ? fmtPct(livePnlPct) : ""} · entry ${fmtPrice(pos.entrySol)}`
            : `${fmtPct(change)} 24h`}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <button
          onClick={onBuy}
          className="burn-gradient rounded-lg px-3 py-2 text-[11px] font-black tracking-wide text-black active:scale-[0.98]"
        >
          BUY
        </button>
        <button
          onClick={onUnsave}
          aria-label="Remove from favourites"
          title="Remove from favourites"
          className="rounded-lg border border-line px-3 py-2 text-accent transition active:scale-95"
        >
          <StarIcon className="h-4 w-4" filled />
        </button>
      </div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 rounded-2xl border border-line bg-panel px-4 py-8 text-center text-[12px] text-muted">
      {children}
    </div>
  );
}

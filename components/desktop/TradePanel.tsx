"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CoinDTO } from "@/lib/types";
import { CoinAvatar } from "../CoinAvatar";
import { useTrader } from "../TraderProvider";
import { useTick } from "@/lib/use-tick";
import { fmtCount, fmtPct, fmtPrice, fmtSol, fmtUsd, sym, timeAgo } from "@/lib/format";

type Detail = {
  coin: CoinDTO;
  trades: { side: string; symbol: string; solAmount: number; who: string; at: string }[];
  position: { tokens: number; valueSol: number; pnlPct: number } | null;
};

/**
 * The right rail: the coin behind whatever clip is centred.
 *
 * It is a read-out plus the one action — trade it. The sheet itself is owned a
 * level up (the stage's buy button opens the same one), so there is exactly one
 * place a swap can be built.
 */
export function TradePanel({ coin, onTrade }: { coin: CoinDTO | null; onTrade: () => void }) {
  const { solUsd } = useTrader();
  const [detail, setDetail] = useState<Detail | null>(null);

  /**
   * Hooks must run on *every* render, so this sits above the `!coin` early
   * return below. Putting it after would give the first render (no coin yet) one
   * fewer hook than the next (coin arrived) and React throws — which is exactly
   * what took the whole route down.
   */
  const cap = useTick((coin?.marketCapSol ?? 0) * solUsd);

  useEffect(() => {
    if (!coin) {
      setDetail(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/coins/${coin.symbol}`, { cache: "no-store" });
        const j = await r.json();
        if (alive && r.ok) setDetail(j as Detail);
      } catch {
        /* keep the last read-out */
      }
    };
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [coin]);

  if (!coin) {
    return (
      <aside className="flex w-[340px] shrink-0 items-center justify-center border-l border-line bg-panel/40 p-6 text-center text-[12px] text-muted">
        Swipe a clip to see its coin.
      </aside>
    );
  }

  const up = coin.change24hPct >= 0;
  const trades = detail?.trades ?? [];

  return (
    <aside className="no-scrollbar w-[340px] shrink-0 overflow-y-auto border-l border-line bg-panel/40">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-panel2">
            <CoinAvatar src={coin.imageUrl} symbol={coin.symbol} className="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-black leading-tight">{coin.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <span className="font-bold text-ink/70">${sym(coin.symbol)}</span>
              {coin.complete && (
                <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-black text-accent">
                  GRAD
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-panel p-3.5">
          <div className="text-[28px] font-black leading-none tabular-nums">
            <span
              key={cap.nonce}
              className={`-mx-1 inline-block rounded-md px-1 ${
                cap.dir === "up" ? "tick-up" : cap.dir === "down" ? "tick-down" : ""
              }`}
            >
              {fmtUsd(coin.marketCapSol * solUsd)}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-muted">
            market cap
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`rounded px-1.5 py-0.5 font-bold tabular-nums ${
                up ? "bg-up/20 text-up" : "bg-down/20 text-down"
              }`}
            >
              24h {fmtPct(coin.change24hPct)}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-bold tabular-nums ${
                coin.change5mPct >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down"
              }`}
            >
              5m {fmtPct(coin.change5mPct)}
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Cell label="price" value={`${fmtPrice(coin.priceSol)} SOL`} />
          <Cell label="holders" value={fmtCount(coin.holders)} />
          <Cell label="24h volume" value={`${fmtSol(coin.volume24hSol)} SOL`} />
          <Cell label="supply" value={fmtSol(Number(coin.totalSupply) / 1e6)} />
        </div>

        {detail?.position && (
          <div className="mt-3 rounded-2xl border border-line bg-panel p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
              your position
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[18px] font-black tabular-nums">
                {fmtSol(detail.position.tokens)} ${sym(coin.symbol)}
              </span>
              <span
                className={`text-[13px] font-bold tabular-nums ${
                  detail.position.pnlPct >= 0 ? "text-up" : "text-down"
                }`}
              >
                {fmtPct(detail.position.pnlPct)}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={onTrade}
          className="press mt-4 w-full rounded-xl burn-gradient py-3.5 text-[14px] font-black tracking-wide text-black"
        >
          Trade ${sym(coin.symbol)}
        </button>
        <p className="mt-2.5 text-center text-[10px] leading-relaxed text-muted">
          Real SOL, signed by your own wallet. Memecoins can go to zero.
        </p>

        <div className="mt-5 text-[11px] font-bold uppercase tracking-wider text-muted">
          recent fills
        </div>
        <div className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {trades.slice(0, 12).map((t, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2 text-[11px]">
              <span
                className={`w-9 shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-black ${
                  t.side === "BUY" ? "bg-up/20 text-up" : "bg-down/20 text-down"
                }`}
              >
                {t.side}
              </span>
              <span className="truncate text-muted">@{t.who}</span>
              <span className="ml-auto shrink-0 tabular-nums">{fmtSol(t.solAmount)} SOL</span>
              <span className="shrink-0 text-[9px] text-muted">{timeAgo(t.at)}</span>
            </div>
          ))}
          {trades.length === 0 && (
            <div className="px-3 py-5 text-center text-[11px] text-muted">No fills yet.</div>
          )}
        </div>

        <Link
          href={`/t/${coin.mint}`}
          className="mt-4 block text-center text-[11px] font-bold text-accent hover:underline"
        >
          Open the token wall →
        </Link>
      </div>
    </aside>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums">{value}</div>
    </div>
  );
}

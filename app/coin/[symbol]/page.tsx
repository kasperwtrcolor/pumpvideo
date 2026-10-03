"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTrader } from "@/components/TraderProvider";
import { BuySheet } from "@/components/BuySheet";
import type { CoinDTO, ClipDTO } from "@/lib/types";
import { fmtCount, fmtPct, fmtPrice, fmtSol, fmtUsd, shortAddr, sym, timeAgo } from "@/lib/format";
import { CoinAvatar } from "@/components/CoinAvatar";
import { TokenFollowButton } from "@/components/FollowButton";

type Detail = {
  coin: CoinDTO;
  /** Whether the viewer follows this token. */
  following?: boolean;
  clips: ClipDTO[];
  trades: {
    side: string;
    symbol: string;
    solAmount: number;
    priceSol: number;
    who: string;
    at: string;
  }[];
  position: {
    tokens: number;
    costSol: number;
    valueSol: number;
    pnlSol: number;
    pnlPct: number;
  } | null;
};

export default function CoinPage({ params }: PageProps<"/coin/[symbol]">) {
  const { symbol } = use(params);
  const { solUsd } = useTrader();
  const [d, setD] = useState<Detail | null>(null);
  const [sheet, setSheet] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/coins/${symbol}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.detail ?? "not found");
      return;
    }
    setD(j as Detail);
  }, [symbol]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="font-bold">No coin for “{symbol}”.</p>
        <Link href="/coins" className="text-xs text-accent">
          back to coins
        </Link>
      </div>
    );
  }
  if (!d) return <div className="p-6 text-xs text-muted">loading…</div>;

  const { coin } = d;
  const up = coin.change24hPct >= 0;

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl pb-28">
        {/* clip hero */}
        <div className="relative h-[46vh] w-full overflow-hidden bg-black">
          {d.clips[0]?.videoUrl ? (
            <video
              src={d.clips[0].videoUrl}
              poster={d.clips[0].thumbUrl ?? undefined}
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          ) : coin.imageUrl ? (
            // Covers both "no clip at all" and "a clip whose video has not been
            // rendered yet" — a freshly ingested token. Same art either way.
            <CoinAvatar
              src={coin.imageUrl}
              symbol={coin.symbol}
              className="h-full w-full"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-black/40" />
          <Link
            href="/coins"
            className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-bold text-white"
          >
            ← coins
          </Link>
        </div>

        <div className="-mt-10 px-4">
          <div className="flex items-end gap-3">
            {coin.imageUrl ? (
              <CoinAvatar
                src={coin.imageUrl}
                symbol={coin.symbol}
                className="h-14 w-14 rounded-full border-2 border-bg object-cover"
              />
            ) : (
              <div className="h-14 w-14 rounded-full border-2 border-bg bg-panel2" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-black">{coin.name}</h1>
              <p className="text-xs text-muted">
                ${sym(coin.symbol)} · launched {timeAgo(coin.launchedAt ?? coin.createdAt)} ago
              </p>
            </div>
            {coin.complete && (
              <span className="rounded-md bg-accent/20 px-2 py-1 text-[10px] font-bold text-accent">
                GRADUATED
              </span>
            )}
          </div>

          {/* Following a token puts every clip bound to it — whoever uploaded
              them — on the viewer's Following wall, and notifies them when a new
              one lands. That is different from saving one clip. */}
          <div className="mt-3">
            <TokenFollowButton mint={coin.mint} initialFollowing={Boolean(d.following)} size="md" />
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <div className="text-3xl font-black tabular-nums">
              {fmtPrice(coin.priceSol)}
              <span className="ml-1.5 text-sm font-bold text-muted">SOL</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded px-1.5 py-0.5 font-bold tabular-nums ${
                  up ? "bg-up/20 text-up" : "bg-down/20 text-down"
                }`}
              >
                24h {fmtPct(coin.change24hPct)}
              </span>
              {/* The trailing 5-minute move — the same number the Hot rail ranks
                  on. Shown so the ranking is legible, not a black box. */}
              <span
                className={`rounded px-1.5 py-0.5 font-bold tabular-nums ${
                  coin.change5mPct >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down"
                }`}
              >
                5m {fmtPct(coin.change5mPct)}
              </span>
              <span className="text-muted tabular-nums">
                MC {fmtUsd(coin.marketCapSol * solUsd)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Cell label="supply" value={`${fmtSol(Number(coin.totalSupply) / 1e6)}`} />
              <Cell label="curve SOL" value={fmtSol(Number(coin.virtualSol) / 1e9)} />
              <Cell label="holders" value={fmtCount(coin.holders)} />
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setSheet(true)}
                className="burn-gradient flex-1 rounded-xl py-3 text-sm font-black text-black"
              >
                buy ${sym(coin.symbol)}
              </button>
              <button
                onClick={() => setSheet(true)}
                className="rounded-xl border border-line bg-panel2 px-4 py-3 text-sm font-bold text-down"
              >
                sell
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted">
              <span className="rounded bg-panel2 px-2 py-1 font-mono">
                {shortAddr(coin.mint, 5)}
              </span>
              {coin.website && (
                <a href={coin.website} target="_blank" className="rounded bg-panel2 px-2 py-1 hover:text-ink">
                  site
                </a>
              )}
              {coin.twitter && (
                <a href={coin.twitter} target="_blank" className="rounded bg-panel2 px-2 py-1 hover:text-ink">
                  x
                </a>
              )}
              {coin.telegram && (
                <a href={coin.telegram} target="_blank" className="rounded bg-panel2 px-2 py-1 hover:text-ink">
                  tg
                </a>
              )}
            </div>
          </div>

          {d.position && (
            <div className="mt-3 rounded-2xl border border-line bg-panel p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                your position
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-black tabular-nums">
                  {fmtSol(d.position.tokens)} ${sym(coin.symbol)}
                </span>
                <span
                  className={`text-sm font-bold tabular-nums ${
                    d.position.pnlSol >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {fmtPct(d.position.pnlPct)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted tabular-nums">
                cost {fmtSol(d.position.costSol)} SOL · value {fmtSol(d.position.valueSol)} SOL
              </div>
            </div>
          )}

          <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">
            clips ({d.clips.length})
          </h2>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
            {d.clips.map((c) =>
              // A clip with no rendered video yet shows its art here too — an
              // empty <video> would be a black box in the strip.
              c.videoUrl ? (
                <video
                  key={c.id}
                  src={c.videoUrl}
                  poster={c.thumbUrl ?? undefined}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  className="h-40 w-24 shrink-0 rounded-lg border border-line object-cover"
                />
              ) : (
                <div
                  key={c.id}
                  className="h-40 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-panel2"
                >
                  <CoinAvatar
                    src={coin.imageUrl}
                    symbol={coin.symbol}
                    className="h-full w-full"
                  />
                </div>
              ),
            )}
          </div>

          <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">
            recent fills
          </h2>
          <div className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
            {d.trades.map((t, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-xs">
                <span
                  className={`w-10 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-black ${
                    t.side === "BUY" ? "bg-up/20 text-up" : "bg-down/20 text-down"
                  }`}
                >
                  {t.side}
                </span>
                <span className="text-muted">@{t.who}</span>
                <span className="tabular-nums">{fmtSol(t.solAmount)} SOL</span>
                <span className="ml-auto text-[10px] text-muted">{timeAgo(t.at)} ago</span>
              </div>
            ))}
            {d.trades.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted">
                No fills yet — be first.
              </div>
            )}
          </div>
        </div>
      </div>

      {sheet && (
        <BuySheet
          coin={coin}
          open
          onClose={() => setSheet(false)}
          onFilled={() => void load()}
        />
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel2 px-2.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="text-sm font-black tabular-nums">{value}</div>
    </div>
  );
}

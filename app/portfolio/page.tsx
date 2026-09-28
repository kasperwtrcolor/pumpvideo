"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AccountResponse } from "@/lib/types";
import { useTrader } from "@/components/TraderProvider";
import { BuySheet } from "@/components/BuySheet";
import { fmtPct, fmtSol, fmtUsd, timeAgo } from "@/lib/format";
import type { CoinDTO } from "@/lib/types";
import { CoinAvatar } from "@/components/CoinAvatar";
import { sym } from "@/lib/format";

export default function PortfolioPage() {
  const { solUsd, refresh } = useTrader();
  const [data, setData] = useState<AccountResponse | null>(null);
  const [sellMint, setSellMint] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/account", { cache: "no-store" });
    setData((await r.json()) as AccountResponse);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const up = (data?.pnlSol ?? 0) >= 0;

  // Resolve the full coin for the sell sheet (BuySheet needs curve reserves).
  const [sellCoin, setSellCoin] = useState<CoinDTO | null>(null);
  useEffect(() => {
    if (!sellMint) return setSellCoin(null);
    const row = data?.positions.find((p) => p.mint === sellMint);
    if (!row) return;
    fetch(`/api/coins/${row.symbol}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSellCoin(j.coin ?? null))
      .catch(() => setSellCoin(null));
  }, [sellMint, data]);

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-3 pb-24 pt-4">
        <h1 className="text-2xl font-black tracking-tight">Portfolio</h1>
        <p className="mt-1 text-xs text-muted">
          Practice book. Fills priced off live on-chain reserves — no SOL moves.
        </p>

        <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
            equity
          </div>
          <div className="mt-1 text-3xl font-black tabular-nums">
            {data ? `${fmtSol(data.equity)} SOL` : "—"}
          </div>
          <div className="text-xs text-muted tabular-nums">
            {data ? fmtUsd(data.equity * solUsd) : ""}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Cell label="cash" value={data ? `${fmtSol(data.cashSol)}` : "—"} />
            <Cell label="holdings" value={data ? `${fmtSol(data.holdingsValue)}` : "—"} />
            <Cell
              label="total pnl"
              value={data ? fmtPct(data.pnlPct) : "—"}
              tone={up ? "up" : "down"}
            />
          </div>
        </div>

        <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">
          positions {data ? `(${data.positions.length})` : ""}
        </h2>
        <div className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {data?.positions.map((p) => (
            <div key={p.mint} className="flex items-center gap-3 px-3 py-3">
              {p.imageUrl ? (
                <CoinAvatar
                  src={p.imageUrl}
                  symbol={p.symbol}
                  className="h-10 w-10 shrink-0 rounded-full"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">
                  ${sym(p.symbol)}
                  <span className="ml-1.5 text-[11px] font-normal text-muted">
                    {fmtSol(p.tokens)}
                  </span>
                </div>
                <div className="text-[10px] text-muted tabular-nums">
                  cost {fmtSol(p.costSol)} SOL · value {fmtSol(p.valueSol)} SOL
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className={`text-sm font-bold tabular-nums ${
                    p.pnlSol >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {fmtPct(p.pnlPct)}
                </div>
                <div className="text-[10px] text-muted tabular-nums">
                  {p.pnlSol >= 0 ? "+" : ""}
                  {fmtSol(p.pnlSol)} SOL
                </div>
              </div>
              <button
                onClick={() => setSellMint(p.mint)}
                className="shrink-0 rounded-lg border border-line bg-panel2 px-3 py-2 text-[11px] font-bold text-down hover:border-down"
              >
                sell
              </button>
            </div>
          ))}

          {data && data.positions.length === 0 && (
            <div className="px-3 py-10 text-center text-xs text-muted">
              No positions.{" "}
              <Link href="/" className="text-accent">
                Swipe the feed
              </Link>{" "}
              and buy a clip.
            </div>
          )}
        </div>

        <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">
          recent fills
        </h2>
        <div className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {data?.trades.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-xs">
              <span
                className={`w-10 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-black ${
                  t.side === "BUY" ? "bg-up/20 text-up" : "bg-down/20 text-down"
                }`}
              >
                {t.side}
              </span>
              <span className="font-bold">${sym(t.symbol)}</span>
              <span className="text-muted tabular-nums">{fmtSol(t.solAmount)} SOL</span>
              <span className="ml-auto text-[10px] text-muted">{timeAgo(t.at)} ago</span>
            </div>
          ))}
          {data && data.trades.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted">No fills yet.</div>
          )}
        </div>
      </div>

      {sellCoin && (
        <BuySheet
          coin={sellCoin}
          open
          onClose={() => setSellMint(null)}
          onFilled={() => {
            void load();
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-xl border border-line bg-panel2 px-2.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div
        className={`text-sm font-black tabular-nums ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

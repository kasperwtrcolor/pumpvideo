"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AccountResponse, CoinDTO } from "@/lib/types";
import { useTrader } from "@/components/TraderProvider";
import { BuySheet } from "@/components/BuySheet";
import { CoinAvatar } from "@/components/CoinAvatar";
import { EmptyState } from "@/components/Mascots";
import { fmtPct, fmtSol, fmtUsd, sym, timeAgo } from "@/lib/format";

/**
 * The live book: positions and fills read straight from the chain through
 * /api/account. Extracted from the old /portfolio page so the account route can
 * own it alongside wallet management.
 */
export function PositionsSection() {
  const { solUsd, refresh } = useTrader();
  const [data, setData] = useState<AccountResponse | null>(null);
  const [sellMint, setSellMint] = useState<string | null>(null);
  const [sellCoin, setSellCoin] = useState<CoinDTO | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/account", { cache: "no-store" });
    setData((await r.json()) as AccountResponse);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  // Resolve the full coin for the sell sheet (BuySheet needs curve reserves).
  useEffect(() => {
    if (!sellMint) return setSellCoin(null);
    const row = data?.positions.find((p) => p.mint === sellMint);
    if (!row) return;
    fetch(`/api/coins/${row.symbol}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSellCoin(j.coin ?? null))
      .catch(() => setSellCoin(null));
  }, [sellMint, data]);

  const up = (data?.pnlSol ?? 0) >= 0;

  return (
    <>
      <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">Your book</h2>
      <div className="mt-2 rounded-2xl border border-line bg-panel p-4">
        <div className="mt-1 grid grid-cols-3 gap-2">
          <Cell label="holdings" value={data ? `${fmtSol(data.holdingsValue)}` : "—"} />
          <Cell label="cost basis" value={data ? `${fmtSol(data.costBasis)}` : "—"} />
          <Cell label="unreal. pnl" value={data ? fmtPct(data.pnlPct) : "—"} tone={up ? "up" : "down"} />
        </div>
        <div className="mt-3 text-[10px] text-muted tabular-nums">
          {data?.walletSol != null
            ? `wallet value ${fmtSol(data.walletSol)} SOL · ${fmtUsd(data.walletSol * solUsd)}`
            : ""}
        </div>
      </div>

      <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">
        positions {data ? `(${data.positions.length})` : ""}
      </h2>
      <div className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
        {data?.positions.map((p) => {
          const up = p.pnlSol >= 0;
          return (
            // Big-type row, matching the coin index's style (components/CoinRow
            // is not reused here because a holding headlines its *unrealised
            // move*, not a market cap). The ticker leads, the move is the
            // headline number, and the row is washed by direction — a book is
            // scanned for "what is up and what is down" before it is read.
            <div
              key={p.mint}
              className={`flex items-center gap-3.5 px-3.5 py-3.5 ${
                up ? "bg-up/[0.07]" : "bg-down/[0.07]"
              }`}
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-panel2">
                <CoinAvatar src={p.imageUrl} symbol={p.symbol} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[18px] font-black leading-tight">${sym(p.symbol)}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted tabular-nums">
                  <span className="font-bold text-ink/70">{fmtSol(p.tokens)}</span>
                  <span aria-hidden className="opacity-40">
                    ·
                  </span>
                  <span>cost {fmtSol(p.costSol)} SOL</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className={`text-[20px] font-black leading-none tabular-nums ${
                    up ? "text-up" : "text-down"
                  }`}
                >
                  {fmtPct(p.pnlPct)}
                </div>
                <div
                  className={`mt-1.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums ${
                    up ? "bg-up/15 text-up" : "bg-down/15 text-down"
                  }`}
                >
                  {up ? "+" : ""}
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
          );
        })}

        {data && data.positions.length === 0 && (
          <EmptyState
            mascot="slerf"
            size={72}
            title="No positions."
            className="py-10"
            body={
              <>
                <Link href="/" className="text-accent">
                  Swipe the feed
                </Link>{" "}
                and buy a clip.
              </>
            }
          />
        )}
      </div>

      <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">recent fills</h2>
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
            {t.txSig && (
              <a
                href={`https://explorer.solana.com/tx/${t.txSig}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-black tracking-wide text-accent"
              >
                ON-CHAIN ↗
              </a>
            )}
            <span className="ml-auto text-[10px] text-muted">{timeAgo(t.at)} ago</span>
          </div>
        ))}
        {data && data.trades.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted">No fills yet.</div>
        )}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        This book mirrors your live on-chain positions. Every fill settles directly in your
        wallet — the &ldquo;recent fills&rdquo; list links each one to the chain.
      </p>

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
    </>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-line bg-panel2 px-2.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted">{label}</div>
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

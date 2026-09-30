"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CoinDTO } from "@/lib/types";
import { useTrader } from "@/components/TraderProvider";
import { BuySheet } from "@/components/BuySheet";
import { fmtCount, fmtPct, fmtPrice, fmtSol, fmtUsd, timeAgo, sym } from "@/lib/format";
import { CoinAvatar } from "@/components/CoinAvatar";

type Sort = "hot" | "new" | "top" | "clips";

type Stats = {
  coins: number;
  clips: number;
  graduated: number;
  totalMarketCapSol: number;
  totalMarketCapUsd: number;
  volume24hSol: number;
  traders: number;
  trades: number;
  /** Total SOL paid to clip creators across the app, and how many buys paid it. */
  rewardsPaidSol: number;
  rewardsPaidCount: number;
  solUsd: number;
};

type CoinRow = CoinDTO & { clipCount: number; clip: string | null };

const SORTS: { key: Sort; label: string }[] = [
  { key: "hot", label: "Hot" },
  { key: "new", label: "New" },
  { key: "top", label: "Top" },
  { key: "clips", label: "Via clips" },
];

export default function CoinsPage() {
  const { solUsd } = useTrader();
  const [sort, setSort] = useState<Sort>("hot");
  const [q, setQ] = useState("");
  const [graduated, setGraduated] = useState(false);
  const [rows, setRows] = useState<CoinRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<CoinRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ sort, limit: "40" });
      if (q.trim()) p.set("q", q.trim());
      if (graduated) p.set("graduated", "1");
      const [r, s] = await Promise.all([
        fetch(`/api/coins?${p}`, { cache: "no-store" }),
        fetch("/api/stats", { cache: "no-store" }),
      ]);
      const j = await r.json();
      const sj = await s.json();
      setRows(j.items ?? []);
      setStats(sj);
    } finally {
      setLoading(false);
    }
  }, [sort, q, graduated]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-3 pb-24 pt-4">
        <h1 className="text-2xl font-black tracking-tight">Coins</h1>
        <p className="mt-1 text-xs text-muted">
          Every coin with a clip. Watch it, buy it, move on.
        </p>

        {/* The rewards ledger, in public.
            The app's promise is that creators get paid — so the proof belongs on
            the front of the coin index, not buried in a settings page. The
            figure is summed from fees that actually settled on-chain, so it
            cannot drift from reality. At zero, the strip states the deal rather
            than parading a meaningless "0 SOL". */}
        {stats && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
            <span aria-hidden className="text-lg">
              💸
            </span>
            <div className="min-w-0">
              {stats.rewardsPaidSol > 0 ? (
                <>
                  <div className="text-sm font-black tabular-nums text-accent">
                    {fmtSol(stats.rewardsPaidSol)} SOL
                    <span className="ml-1.5 font-bold text-muted">paid to creators</span>
                  </div>
                  <div className="text-[10px] text-muted tabular-nums">
                    ≈ {fmtUsd(stats.rewardsPaidSol * solUsd)} across {fmtCount(stats.rewardsPaidCount)}{" "}
                    buy{stats.rewardsPaidCount === 1 ? "" : "s"} · settled on-chain
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-black text-accent">Creators get paid</div>
                  <div className="text-[10px] leading-relaxed text-muted">
                    1% of every buy through a clip goes to whoever posted it — settled straight to
                    their wallet.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {stats && (
          <div className="mt-4 grid grid-cols-4 gap-2">
            <Stat label="Coins" value={fmtCount(stats.coins)} />
            <Stat label="Clips" value={fmtCount(stats.clips)} />
            <Stat label="Graduated" value={fmtCount(stats.graduated)} />
            <Stat
              label="Mkt cap"
              value={fmtUsd(stats.totalMarketCapUsd)}
              sub={solUsd ? `${fmtSol(stats.totalMarketCapSol)} SOL` : undefined}
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-full border border-line bg-panel p-1">
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
          </div>
          <button
            onClick={() => setGraduated((g) => !g)}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
              graduated
                ? "border-accent bg-accent/15 text-accent"
                : "border-line bg-panel text-muted hover:text-ink"
            }`}
          >
            Graduated
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search coins and mints"
          className="mt-3 w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
        />

        <div className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {rows.map((c) => (
            <button
              key={c.mint}
              onClick={() => setSheet(c)}
              className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-panel2"
            >
              <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-panel2">
                <CoinAvatar
                  src={c.imageUrl}
                  symbol={c.symbol}
                  className="h-full w-full"
                />
                {c.clip && (
                  <video
                    src={c.clip}
                    muted
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-bold">{c.name}</span>
                  <span className="text-[12px] text-muted">${sym(c.symbol)}</span>
                  {c.complete && (
                    <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold text-accent">
                      GRAD
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                  <span>{c.clipCount} clip{c.clipCount === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>{timeAgo(c.launchedAt)} ago</span>
                  <span>·</span>
                  <span>{fmtCount(c.holders)} holders</span>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[15px] font-bold tabular-nums">
                  {fmtSol(c.marketCapSol)}
                  <span className="ml-1 text-[10px] font-semibold text-muted">SOL</span>
                </div>
                <div className="text-[11px] text-muted tabular-nums">
                  {fmtPrice(c.priceSol)} SOL
                </div>
                <div
                  className={`text-[11px] font-bold tabular-nums ${
                    c.change24hPct >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {fmtPct(c.change24hPct)}
                </div>
              </div>
            </button>
          ))}

          {!loading && rows.length === 0 && (
            <div className="px-3 py-10 text-center text-xs text-muted">
              No coins match. Try <Link href="/" className="text-accent">the feed</Link>.
            </div>
          )}
          {loading && (
            <div className="px-3 py-8 text-center text-xs text-muted">loading…</div>
          )}
        </div>
      </div>

      {sheet && (
        <BuySheet
          coin={sheet}
          open
          onClose={() => setSheet(null)}
          onFilled={({ priceSol }) => {
            setRows((prev) =>
              prev.map((r) => (r.mint === sheet.mint ? { ...r, priceSol } : r)),
            );
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-2.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className="text-sm font-black tabular-nums">{value}</div>
      {sub && <div className="text-[9px] text-muted tabular-nums">{sub}</div>}
    </div>
  );
}

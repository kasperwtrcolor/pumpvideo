"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CoinDTO } from "@/lib/types";
import { useTrader } from "@/components/TraderProvider";
import { fmtCount, fmtSol, fmtUsd } from "@/lib/format";
import { CoinRow } from "@/components/CoinRow";

type Sort = "top" | "movers" | "new" | "trending" | "clips";

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
  { key: "top", label: "Top" },
  { key: "movers", label: "Movers" },
  { key: "new", label: "New" },
  { key: "trending", label: "Trending" },
  { key: "clips", label: "Via clips" },
];

export default function CoinsPage() {
  const { solUsd } = useTrader();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>("top");
  const [q, setQ] = useState("");
  const [graduated, setGraduated] = useState(false);
  const [rows, setRows] = useState<CoinRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

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

        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {rows.map((c) => (
            // The row itself lives in components/CoinRow, shared with search so
            // the index and its search box cannot drift into two row styles.
            <CoinRow
              key={c.mint}
              href={`/t/${c.mint}`}
              name={c.name}
              symbol={c.symbol}
              imageUrl={c.imageUrl}
              marketCapSol={c.marketCapSol}
              change24hPct={c.change24hPct}
              launchedAt={c.launchedAt}
              complete={c.complete}
              quoteSymbol={c.quoteSymbol}
              quoteName={c.quoteName}
              quoteIconUrl={c.quoteIconUrl}
              clip={c.clip}
              solUsd={solUsd}
            />
          ))}
        </ul>

        {!loading && rows.length === 0 && (
          <div className="mt-3 rounded-2xl border border-line bg-panel px-3 py-10 text-center text-xs text-muted">
            No coins match. Try{" "}
            <Link href="/" className="text-accent">
              the feed
            </Link>
            .
          </div>
        )}
        {loading && (
          <div className="mt-3 px-3 py-8 text-center text-xs text-muted">loading…</div>
        )}
      </div>
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

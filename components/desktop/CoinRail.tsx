"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CoinDTO } from "@/lib/types";
import { CoinAvatar } from "../CoinAvatar";
import { fmtUsd, sym, timeAgo } from "@/lib/format";
import { useTrader } from "../TraderProvider";

/**
 * The desktop feed's left rail: which wall you are looking at.
 *
 * Three live sets (Trending, New, Movers) come straight off `/api/coins`; the two
 * personal ones (Watchlist, Alerts) are doors to their own pages rather than
 * sorts of the catalogue. Picking a coin narrows the centre column to that
 * token's clips — picking it again returns to the whole wall.
 */
type RailSort = "trending" | "new" | "movers";

const TABS: { key: RailSort; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "movers", label: "Movers" },
];

export function CoinRail({
  selectedMint,
  onSelect,
}: {
  selectedMint: string | null;
  onSelect: (mint: string | null) => void;
}) {
  const { solUsd } = useTrader();
  const [sort, setSort] = useState<RailSort>("trending");
  const [rows, setRows] = useState<CoinDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/coins?sort=${sort}&limit=40`, { cache: "no-store" });
      const j = await r.json();
      setRows((j.items ?? []) as CoinDTO[]);
    } catch {
      /* leave the last list standing */
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-panel/40">
      <div className="shrink-0 border-b border-line p-3">
        <div className="flex gap-1 rounded-full border border-line bg-panel p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setSort(t.key);
                onSelect(null);
              }}
              className={`flex-1 rounded-full px-2 py-1.5 text-[12px] font-bold transition ${
                sort === t.key ? "bg-ink text-black" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-3 px-1 text-[12px] font-bold text-muted">
          <Link href="/favorites" className="hover:text-ink">
            Watchlist
          </Link>
          <Link href="/notifications" className="hover:text-ink">
            Alerts
          </Link>
          <Link href="/coins" className="ml-auto hover:text-ink">
            See all →
          </Link>
        </div>
      </div>

      <ul className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {rows.map((c) => {
          const up = c.change24hPct >= 0;
          const active = c.mint === selectedMint;
          return (
            <li key={c.mint}>
              <button
                onClick={() => onSelect(active ? null : c.mint)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
                  active ? "bg-accent/12" : up ? "hover:bg-up/5" : "hover:bg-down/5"
                }`}
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-panel2">
                  <CoinAvatar src={c.imageUrl} symbol={c.symbol} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-black leading-tight">{c.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted">
                    <span className="font-bold text-ink/70">${sym(c.symbol)}</span>
                    <span className="opacity-40"> · </span>
                    <span className="tabular-nums">{timeAgo(c.launchedAt ?? c.createdAt)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[13px] font-black tabular-nums">
                    {fmtUsd(c.marketCapSol * solUsd)}
                  </div>
                  <div
                    className={`text-[11px] font-bold tabular-nums ${up ? "text-up" : "text-down"}`}
                  >
                    {up ? "↑" : "↓"} {Math.abs(c.change24hPct).toFixed(1)}%
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        {loading && <li className="px-3 py-6 text-center text-[11px] text-muted">loading…</li>}
        {!loading && rows.length === 0 && (
          <li className="px-3 py-6 text-center text-[11px] text-muted">nothing here yet.</li>
        )}
      </ul>
    </aside>
  );
}

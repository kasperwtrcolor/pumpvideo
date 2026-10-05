"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CoinAvatar } from "../CoinAvatar";
import { fmtSol, sym, timeAgo } from "@/lib/format";

type Row = {
  id: string;
  side: string;
  symbol: string;
  mint: string;
  imageUrl: string | null;
  solAmount: number;
  who: string;
  at: string;
};

/** How often the tape refreshes. A real feed moves in seconds; a poll that
 *  matches that is cheap because the endpoint is one indexed scan. */
const POLL_MS = 5000;

/**
 * The centre-left tape: every fill, newest first, across the whole app.
 *
 * Rendered beside the player so the wall has a pulse — watching a clip and
 * watching the room trade it are the same act on a clip-coin feed.
 */
export function LiveTrades() {
  const [trades, setTrades] = useState<Row[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/trades?limit=40", { cache: "no-store" });
        const j = (await r.json()) as { trades?: Row[] };
        if (alive) setTrades(j.trades ?? []);
      } catch {
        /* a missed poll is not worth surfacing */
      }
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-line bg-panel/30">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 text-[11px] font-black uppercase tracking-wider text-muted">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-up" />
        Live trades
      </div>
      <ul className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {trades.map((t) => {
          const buy = t.side === "BUY";
          return (
            <li key={t.id}>
              <Link
                href={`/t/${t.mint}`}
                className="flex items-center gap-2.5 px-3 py-2 transition hover:bg-panel2"
              >
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded-lg bg-panel2">
                  <CoinAvatar src={t.imageUrl} symbol={t.symbol} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-black">${sym(t.symbol)}</div>
                  <div className="truncate text-[10px] text-muted">@{t.who}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`text-[12px] font-black tabular-nums ${buy ? "text-up" : "text-down"}`}
                  >
                    {buy ? "+" : "−"}
                    {fmtSol(t.solAmount)}
                  </div>
                  <div className="text-[9px] text-muted">{timeAgo(t.at)}</div>
                </div>
              </Link>
            </li>
          );
        })}
        {trades.length === 0 && (
          <li className="px-3 py-6 text-center text-[11px] text-muted">
            no fills yet — be the first.
          </li>
        )}
      </ul>
    </div>
  );
}

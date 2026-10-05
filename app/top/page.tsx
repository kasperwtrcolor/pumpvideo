"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTrader } from "@/components/TraderProvider";
import { CoinAvatar } from "@/components/CoinAvatar";
import { POINT_LEGEND } from "@/lib/points";
import { fmtCount, fmtSol } from "@/lib/format";

type Line = { key: string; label: string; count: number; each: number; points: number; unit: "count" | "sol" };

type Entry = {
  rank: number;
  id: string;
  slug: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  points: number;
  stats: {
    clips: number;
    likes: number;
    comments: number;
    shares: number;
    followers: number;
    trades: number;
    volumeSol: number;
    rewardsSol: number;
  };
  lines: Line[];
};

/**
 * The Top page: traders ranked by Pemp Points.
 *
 * The score is explained on the page rather than hidden, because a leaderboard
 * nobody can understand is just a list of names. Every term is a fact the app
 * already records — clips, the engagement they drew, trades, and the creator cut
 * actually paid on-chain — so anyone reading it can see exactly how the person
 * above them got there, and what to do about it.
 */
export default function TopPage() {
  const { trader } = useTrader();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/leaderboard?limit=50", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setEntries(j.entries ?? []);
        setTotal(j.total ?? 0);
      } catch {
        /* the empty state below covers it */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="no-scrollbar h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[clamp(30px,4vw,44px)] font-black uppercase leading-none tracking-tight">
              Top <span className="text-accent">traders</span>
            </h1>
            <p className="mt-2 text-[13px] text-muted">
              Ranked by Pemp Points — what you post, what it earns, and what you trade.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">ranked</div>
            <div className="text-[22px] font-black tabular-nums">{fmtCount(total)}</div>
          </div>
        </div>

        {/* The rules, in the open — a score nobody can read is just names. */}
        <div className="mt-5 flex flex-wrap gap-2">
          {POINT_LEGEND.map((p) => (
            <span
              key={p.label}
              className="rounded-full border border-line bg-panel px-3 py-1 text-[11px] font-bold text-muted"
            >
              {p.label} <span className="text-accent">{p.value}</span>
            </span>
          ))}
        </div>

        {loading && <div className="py-16 text-center text-[13px] text-muted">loading…</div>}

        {!loading && entries.length === 0 && (
          <div className="mt-6 rounded-2xl border border-line bg-panel px-4 py-14 text-center">
            <p className="text-[15px] font-black">Nobody has scored yet.</p>
            <p className="mt-1.5 text-[13px] text-muted">
              Post a clip and your first points land the moment it is watched, liked or bought.
            </p>
            <Link
              href="/upload"
              className="press mt-5 inline-block rounded-xl burn-gradient px-5 py-2.5 text-[13px] font-black text-black"
            >
              Post a clip
            </Link>
          </div>
        )}

        <ul className="mt-3 space-y-1.5">
          {entries.map((e) => {
            const mine = Boolean(trader?.username && trader.username === e.username);
            const medal = e.rank === 1 ? "text-accent" : e.rank <= 3 ? "text-ink" : "text-muted";
            const expanded = open === e.id;
            return (
              <li
                key={e.id}
                className={`row-in overflow-hidden rounded-2xl border transition ${
                  mine ? "border-accent/50 bg-accent/10" : "border-line bg-panel hover:bg-panel2"
                }`}
                style={{ animationDelay: `${Math.min(e.rank, 12) * 35}ms` }}
              >
                <button
                  onClick={() => setOpen(expanded ? null : e.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3.5 px-3.5 py-3 text-left"
                >
                  <span className={`w-6 shrink-0 text-center text-[15px] font-black tabular-nums ${medal}`}>
                    {e.rank}
                  </span>
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-panel2">
                    <CoinAvatar src={e.avatarUrl} symbol={e.name} className="h-full w-full" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-black">
                      {e.name}
                      {mine && <span className="ml-2 text-[10px] font-black text-accent">you</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {e.username ? `@${e.username}` : "no handle yet"}
                      <span className="opacity-40"> · </span>
                      {e.stats.clips} clip{e.stats.clips === 1 ? "" : "s"}
                      {e.stats.rewardsSol > 0 && (
                        <>
                          <span className="opacity-40"> · </span>
                          {fmtSol(e.stats.rewardsSol)} SOL earned
                        </>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[20px] font-black leading-none tabular-nums text-accent">
                      {fmtCount(e.points)}
                    </span>
                    <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wider text-muted">
                      points
                    </span>
                  </span>
                </button>

                {expanded && (
                  <div className="border-t border-line px-3.5 py-3">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                      {e.lines.map((l) => (
                        <div key={l.key} className="flex items-center justify-between gap-3 text-[12px]">
                          <span className="truncate text-muted">
                            {l.label}
                            <span className="text-muted/60">
                              {" "}
                              ×{l.unit === "sol" ? fmtSol(l.count) : l.count}
                            </span>
                          </span>
                          <span className={`shrink-0 font-bold tabular-nums ${l.points > 0 ? "text-ink" : "text-muted/50"}`}>
                            {l.points}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Link
                      href={`/u/${e.slug}`}
                      className="mt-2.5 inline-block text-[11px] font-bold text-accent hover:underline"
                    >
                      View profile →
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {!loading && entries.length > 0 && (
          <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
            Points are recomputed from real activity every time this page loads. Nothing is
            self-reported — the only term nobody can fake is SOL actually earned on-chain.
          </p>
        )}
      </div>
    </div>
  );
}

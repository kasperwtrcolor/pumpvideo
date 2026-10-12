"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CalloutDTO, CalloutSort, CalloutsResponse } from "@/lib/types";
import { EmptyState } from "./Mascots";
import { fmtCount, fmtUsd, timeAgo } from "@/lib/format";

/**
 * The callouts for one coin, shown beside the comments.
 *
 * A callout is a trader publicly calling this token, with the note they wrote
 * and the size of their own position attached — so the rail is a reading of
 * *who is in this* and *what they said*, which is the thing a comment section
 * cannot tell you. It reads pump.fun's public callout feed for the mint.
 *
 * Two orderings, both the upstream feed's own:
 *   - "Top"    — largest holdings first (what the whales are doing)
 *   - "Latest" — most recent first (what is being said right now)
 *
 * Big holders get the lit treatment: a translucent accent card, a single light
 * sweep as it lands, and a halo off the avatar. It is one-shot on mount, so
 * switching the sort replays it and a poll never does.
 */
export function CalloutRail({ mint, open }: { mint: string; open: boolean }) {
  const [sort, setSort] = useState<CalloutSort>("top");
  const [callouts, setCallouts] = useState<CalloutDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (s: CalloutSort, l: number) => {
      setLoading(true);
      setError(false);
      try {
        const r = await fetch(`/api/callouts?mint=${encodeURIComponent(mint)}&sort=${s}&limit=${l}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as CalloutsResponse;
        // Guard against a stale response landing after the user flipped the
        // sort: the body echoes the ordering it was produced for.
        if (j.sort && j.sort !== s) return;
        setCallouts(j.callouts ?? []);
        setTotal(j.total ?? 0);
        setHasMore(Boolean(j.hasMore));
      } catch {
        setError(true);
        setCallouts([]);
      } finally {
        setLoading(false);
      }
    },
    [mint],
  );

  useEffect(() => {
    if (open) void load(sort, limit);
  }, [open, sort, limit, load]);

  /**
   * Which rows are "big holders".
   *
   * The three largest positions on the page, and only those that clear a floor
   * worth lighting up. Both halves matter: a coin can have forty callouts that
   * are all whales, and lighting every row highlights nothing — so it is a
   * fixed top three, not a threshold that a busy coin blows straight past. And
   * the floor stops a $4 "largest holder" on a dead coin from being crowned.
   */
  const whaleIds = useMemo(() => {
    const ids = new Set<string>();
    if (callouts.length === 0) return ids;
    [...callouts]
      .filter((c) => c.valueUsd >= 500)
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 3)
      .forEach((c) => ids.add(c.id));
    return ids;
  }, [callouts]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
        <SortToggle sort={sort} onChange={setSort} />
        {total > 0 && (
          <span className="ml-auto shrink-0 text-[10px] font-semibold text-muted">
            {fmtCount(total)} callout{total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {loading && callouts.length === 0 && <RailSkeleton />}

        {!loading && callouts.length === 0 && (
          <EmptyState
            mascot="fwog"
            size={72}
            title={error ? "Couldn't load callouts." : "No callouts yet."}
            body={error ? "Try again in a moment." : "Nobody has called this one."}
            className="py-10"
          />
        )}

        {callouts.map((c, i) => (
          <CalloutRow
            key={c.id}
            callout={c}
            whale={whaleIds.has(c.id)}
            index={i}
          />
        ))}

        {hasMore && !loading && (
          <button
            onClick={() => setLimit((l) => l + 20)}
            className="mx-4 my-3 w-[calc(100%-2rem)] rounded-xl border border-line bg-panel2 py-2.5 text-[11px] font-bold text-muted hover:text-ink"
          >
            Show more
          </button>
        )}
      </div>
    </div>
  );
}

/** The two orderings, as a segmented control with a sliding thumb. */
function SortToggle({ sort, onChange }: { sort: CalloutSort; onChange: (s: CalloutSort) => void }) {
  const options: { key: CalloutSort; label: string }[] = [
    { key: "top", label: "Top" },
    { key: "latest", label: "Latest" },
  ];
  const active = options.findIndex((o) => o.key === sort);

  return (
    <div className="relative flex rounded-full border border-line bg-panel2 p-0.5">
      {/* The thumb travels between the two slots; the labels sit above it. */}
      <span
        aria-hidden
        className="seg-thumb absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-accent/20 ring-1 ring-inset ring-accent/40"
        style={{ transform: `translateX(${active * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          aria-pressed={sort === o.key}
          className={`relative z-10 w-16 rounded-full px-3 py-1 text-[11px] font-black transition-colors ${
            sort === o.key ? "text-accent" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CalloutRow({
  callout: c,
  whale,
  index,
}: {
  callout: CalloutDTO;
  whale: boolean;
  index: number;
}) {
  // Staggered so a full page arrives as a wave rather than all at once; capped
  // so a long list does not take a second to finish appearing.
  const delay = `${Math.min(index, 12) * 34}ms`;
  const up = c.pnlUsd >= 0;
  const initial = c.author.slice(0, 1).toUpperCase();

  return (
    <div
      className={`relative overflow-hidden border-b border-line px-4 py-3 ${
        whale
          ? "callout-whale callout-whale-in backdrop-blur-md backdrop-saturate-150"
          : "callout-in"
      }`}
      style={{ animationDelay: delay }}
    >
      <div className="flex gap-2.5">
        {/* The avatar, with the halo blooming out of it on a big-holder row. */}
        <div className="relative mt-0.5 h-8 w-8 shrink-0">
          {whale && (
            <span
              aria-hidden
              className="callout-halo pointer-events-none absolute inset-0 rounded-full ring-2 ring-accent/60"
              style={{ animationDelay: `calc(${delay} + 120ms)` }}
            />
          )}
          <div className="relative h-8 w-8 overflow-hidden rounded-full bg-panel2 ring-1 ring-line">
            {c.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[11px] font-black text-muted">
                {initial}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[11px] font-bold">{c.author}</span>
            {c.isVerified && <VerifiedCheck />}
            {whale && (
              <span
                className="callout-badge-in ml-0.5 rounded-full bg-accent/20 px-1.5 py-px text-[8px] font-black uppercase tracking-wider text-accent ring-1 ring-inset ring-accent/40"
                style={{ animationDelay: `calc(${delay} + 220ms)` }}
              >
                whale
              </span>
            )}
            <span className="ml-auto shrink-0 text-[9px] text-muted">
              {c.at ? `${timeAgo(c.at)} ago` : ""}
            </span>
          </div>

          <p className="mt-1 line-clamp-3 break-words text-[13px] leading-snug text-ink/95">
            {c.thesis}
          </p>

          {/* The position the call was made from, and what it has done since. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px]">
            <span className="font-black tabular-nums text-ink">{fmtUsd(c.valueUsd)}</span>
            <span className="text-muted">held</span>
            <span
              className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
                up ? "bg-up/15 text-up" : "bg-down/15 text-down"
              }`}
            >
              {up ? "↑" : "↓"} {fmtUsd(Math.abs(c.pnlUsd))} · {Math.abs(c.pnlPct).toFixed(0)}%
            </span>
            <span className="text-muted">
              called at <span className="tabular-nums text-ink/80">{fmtUsd(c.calledOutAtMcap)}</span>
            </span>
            {c.multiple > 0 && (
              <span
                className={`font-bold tabular-nums ${c.multiple >= 1 ? "text-up" : "text-down"}`}
              >
                {c.multiple.toFixed(1)}x
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-3 text-[9px] text-muted">
            <Stat icon={<IconHeart />} value={c.likes} />
            <Stat icon={<IconEye />} value={c.views} />
            {c.replies > 0 && <Stat icon={<IconReply />} value={c.replies} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, value }: { icon: ReactNode; value: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      <span className="tabular-nums">{fmtCount(value)}</span>
    </span>
  );
}

function RailSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-2.5 border-b border-line px-4 py-3">
          <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="skeleton h-3 w-28 rounded" />
            <div className="skeleton h-3 w-4/5 rounded" />
            <div className="skeleton h-3 w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline SVG — never emoji, so the glyphs inherit currentColor and keep weight */
/* -------------------------------------------------------------------------- */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function VerifiedCheck() {
  return (
    <svg viewBox="0 0 24 24" className="size-3 shrink-0 text-accent" aria-label="verified" {...stroke}>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity="0.18" />
      <path d="M8.5 12.4l2.4 2.4 4.6-5" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" aria-hidden {...stroke}>
      <path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" aria-hidden {...stroke}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function IconReply() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" aria-hidden {...stroke}>
      <path d="M21 11.5a7.5 7.5 0 0 1-10.8 6.7L4 20l1.9-5.1A7.5 7.5 0 1 1 21 11.5z" />
    </svg>
  );
}

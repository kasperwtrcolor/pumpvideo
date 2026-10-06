"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CoinAvatar } from "./CoinAvatar";
import { PairBadge } from "./PairBadge";
import { fmtPctAbs, fmtUsd, sym, timeAgo } from "@/lib/format";

/**
 * The big-type coin row — the index's single row style, shared by every list of
 * coins (the Coins tab and search results).
 *
 * What "big type" means here, and why it is one component rather than per-screen
 * markup: the row leads with the *name* at 18px, the market cap is the headline
 * number on the right at 20px, and the 24h move is a tinted chip beneath it. The
 * whole row is washed green or red by direction, so the list reads by colour
 * before a single figure is parsed. A coin index is scanned, not read, and these
 * three choices (size, position, colour) do the scanning for the eye.
 *
 * Rendered as an `<li>`: the caller supplies the `<ul>`, and an optional
 * `trailing` control (a follow button, say) that must sit outside the link so
 * tapping it does not navigate.
 */
export function CoinRow({
  href,
  name,
  symbol,
  imageUrl,
  marketCapSol,
  change24hPct,
  launchedAt,
  complete,
  quoteSymbol,
  quoteName,
  quoteIconUrl,
  clip,
  solUsd,
  trailing,
}: {
  href: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  marketCapSol: number;
  change24hPct: number;
  /**
   * Launch time, for the secondary line. Optional: search hits do not carry it,
   * and a row without an age is better than a wrong one.
   */
  launchedAt?: string | Date | null;
  /** Graduated badge. */
  complete?: boolean;
  /** The pair this coin is quoted against, when it is not SOL. See PairBadge. */
  quoteSymbol?: string | null;
  quoteName?: string | null;
  quoteIconUrl?: string | null;
  /** A ready clip to preview inside the avatar, when the caller has one. */
  clip?: string | null;
  solUsd: number;
  /** Trailing control rendered outside the link (e.g. a follow button). */
  trailing?: ReactNode;
}) {
  const up = change24hPct >= 0;
  return (
    <li
      className={`flex items-center gap-1 pr-3.5 transition ${
        up ? "bg-up/[0.07]" : "bg-down/[0.07]"
      }`}
    >
      {/* A whole row is the target, and it goes to the token's clip wall —
          watching is the reason you tapped a coin, so the first screen shows
          its clips rather than a buy dialog. Buying lives on each clip. */}
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-3.5 px-3.5 py-3.5 text-left hover:bg-panel2"
      >
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-panel2">
          <CoinAvatar src={imageUrl} symbol={symbol} className="h-full w-full" />
          {clip && (
            <video
              src={clip}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[18px] font-black leading-tight">{name}</span>
            {complete && (
              <span className="shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-black text-accent">
                GRAD
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
            <span className="font-bold text-ink/70">${sym(symbol)}</span>
            {launchedAt ? (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span className="tabular-nums">{timeAgo(launchedAt)}</span>
              </>
            ) : null}
            {/* The pair, when it is not SOL. Rides the secondary line rather than
                the name line so it never pushes the name out of the row. */}
            {quoteSymbol && (
              <PairBadge
                label={quoteName ?? quoteSymbol}
                title={`paired with ${quoteName ?? quoteSymbol}`}
                iconUrl={quoteIconUrl}
              />
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          {/* Market cap, in USD — the headline number for this row. */}
          <div className="text-[20px] font-black leading-none tabular-nums">
            {fmtUsd(marketCapSol * solUsd)}
          </div>
          <div
            className={`mt-1.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums ${
              up ? "bg-up/15 text-up" : "bg-down/15 text-down"
            }`}
          >
            <span aria-hidden>{up ? "↑" : "↓"}</span>
            <span>{fmtPctAbs(change24hPct)}</span>
          </div>
        </div>
      </Link>

      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </li>
  );
}

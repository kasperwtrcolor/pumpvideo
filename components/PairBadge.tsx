"use client";

import { useState } from "react";

/**
 * The pair label — what a coin on a non-SOL pair is quoted against.
 *
 * Only StonkFun coins have one: every launch there is quoted against something
 * else, usually a tokenized equity (NVDAX, TSLAX, MCDX) and sometimes another
 * memecoin. The launchpad's whole premise is the pair, so the label is not
 * decoration — it is the one fact that distinguishes this coin from the other
 * four hundred in the feed, and a bare ticker does not carry it. Hence the mark:
 * the counterparty's logo is the part that reads at a glance.
 *
 * Deliberately label-only. The counterparty has its own live price and its own
 * 24h move, and neither is shown here — this badge answers "paired against what",
 * not "what is that worth", and a second ticking number on a feed card competes
 * with the coin's own. The price it belongs next to is on the coin page.
 *
 * A mark that fails to load is dropped rather than substituted: the label text
 * still says everything the pair is, and `CoinAvatar`-style gateway walking would
 * be solving a problem this badge does not have (these are xStock logo URLs, not
 * user-uploaded IPFS art).
 */
export function PairBadge({
  label,
  iconUrl,
  title,
  tone = "panel",
  className = "",
}: {
  label: string;
  iconUrl?: string | null;
  /** Full pair name for the hover tooltip, when the visible label is shortened. */
  title?: string;
  /**
   * `panel` sits on the app's light surfaces (coin rows, the coin page).
   * `overlay` sits on the feed's video, whose chips are translucent black — the
   * same pill, inverted, so it reads as part of that row rather than pasted on it.
   */
  tone?: "panel" | "overlay";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const skin =
    tone === "overlay"
      ? "bg-black/55 border-white/15 text-white/90"
      : "bg-panel2/80 border-line text-muted";
  return (
    <span
      title={title ?? label}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${skin} ${className}`}
    >
      {iconUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
        />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

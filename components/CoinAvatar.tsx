"use client";

import { useEffect, useMemo, useState } from "react";
import { sym } from "@/lib/format";
import { artCandidates } from "@/lib/art-url";

/**
 * Coin art with a real fallback.
 *
 * A meaningful share of pump.fun tokens point at ipfs.io / X-CDN URLs that
 * intermittently 403 or time out. We rewrite IPFS URLs onto gateways that
 * answer, and if one candidate still fails we step to the next before giving
 * up — an empty circle in the feed is worse than a letter.
 */
export function CoinAvatar({
  src,
  symbol,
  className = "",
  ring = false,
}: {
  src: string | null | undefined;
  symbol: string;
  className?: string;
  ring?: boolean;
}) {
  const s = sym(symbol).slice(0, 2).toUpperCase();
  const candidates = useMemo(() => artCandidates(src), [src]);
  const [idx, setIdx] = useState(0);

  // A new src (or a recycled list row) must restart the gateway walk.
  useEffect(() => setIdx(0), [candidates]);

  const current = candidates[idx];

  if (!current) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center bg-panel2 font-black text-muted ${className}`}
      >
        <span className="text-[0.9em]">{s}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={current}
      src={current}
      alt={s}
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
      className={`object-cover ${ring ? "border-2 border-accent" : ""} ${className}`}
    />
  );
}

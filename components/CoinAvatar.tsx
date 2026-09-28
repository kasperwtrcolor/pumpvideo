"use client";

import { useState } from "react";
import { sym } from "@/lib/format";

/**
 * Coin art with a real fallback.
 *
 * A meaningful share of pump.fun tokens point at ipfs.io / X-CDN URLs that
 * intermittently 403 or time out. Without this, those coins render as an empty
 * circle in the feed — worse than a letter.
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
  const [broken, setBroken] = useState(false);
  const s = sym(symbol);

  if (!src || broken) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center bg-panel2 font-black text-muted ${className}`}
      >
        <span className="text-[0.9em]">{s.slice(0, 2).toUpperCase()}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={s}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`object-cover ${ring ? "border-2 border-accent" : ""} ${className}`}
    />
  );
}

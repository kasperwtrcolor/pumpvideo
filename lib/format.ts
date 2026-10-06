/** Display formatting. Small numbers are the norm here — a fresh coin trades at 1e-7 SOL. */

export function fmtSol(n: number | null | undefined, dp = 3): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (a >= 1) return n.toFixed(dp);
  if (a >= 0.001) return n.toFixed(dp);
  // Was `n.toFixed(6)`, which rounds a genuinely small amount — a dust balance,
  // a fresh coin's market cap — down to a flat "0". That reads as "you have
  // nothing" when the truth is "you have a very small amount", so keep
  // significant digits instead.
  return plainDecimal(n, a);
}

/**
 * Decimal places needed to show three significant digits of a value below 1.
 *
 * 4.98e-8 -> 10 places -> "0.0000000498". Capped at toFixed's limit.
 */
function decimalsFor(a: number): number {
  const exp = Math.floor(Math.log10(a));
  return Math.min(20, Math.max(2, -exp + 2));
}

/**
 * Render a sub-1 value as a plain decimal.
 *
 * The guard matters: rounding to three significant digits carries 0.9999 up to
 * "1.000", which trims to "1". A price printed as exactly 1 when it is 0.9999
 * is not a rounding nicety, it is a wrong number — and on a trading screen the
 * difference is the whole point. Widen the precision until the value stops
 * crossing the boundary it was supposed to stay under.
 */
function plainDecimal(n: number, a: number): string {
  let dp = decimalsFor(a);
  if (dp > 20) return n.toExponential(2);
  let out = trimZeros(n.toFixed(dp));
  while (a < 1 && Number(out) >= 1 && dp < 20) {
    dp++;
    out = trimZeros(n.toFixed(dp));
  }
  // Rounding a non-zero value all the way down to "0" is the same lie in the
  // other direction. Below what a plain decimal can show, exponential is the
  // honest answer.
  return out === "0" ? n.toExponential(2) : out;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * Price per token.
 *
 * A fresh coin trades around 1e-8 SOL. This used to render those as
 * `n.toExponential(2)` — "4.98e-8" — which is how a number looks in a debugger,
 * not in a price tag. Small values now render as plain decimals with three
 * significant digits ("0.0000000498"); only absurd magnitudes fall back to
 * exponential, where a compact form is genuinely more readable.
 */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  const a = Math.abs(n);
  if (a >= 1) return n.toFixed(4);
  return plainDecimal(n, a);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (a >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

/**
 * A percentage magnitude, compacted and unsigned — for chips that draw their
 * own direction arrow.
 *
 * Memecoins really do print four-digit percentages: a coin that launches at a
 * rounding error and graduates the same day is up five figures, and a raw
 * `477313.0%` is both unreadable and wider than the row it sits in. Past a
 * thousand the number is summarised the way a trader says it out loud
 * ("477K%"). At a thousand and below it stays exact to one decimal.
 *
 * Unsigned on purpose: `fmtPct` is the signed wrapper, and the list rows want
 * the magnitude because they render `↑`/`↓` and colour the direction instead.
 */
export function fmtPctAbs(n: number | null | undefined, dp = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(a / 1_000_000).toFixed(1)}M%`;
  if (a >= 10_000) return `${Math.round(a / 1000)}K%`;
  if (a >= 1000) return `${(a / 1000).toFixed(1)}K%`;
  return `${a.toFixed(dp)}%`;
}

/**
 * A signed percentage.
 *
 * The one formatter every surface uses, so a move is never `+1,491,000.0%`
 * on one screen and `+1.5M%` on the next. Note the sign is applied *outside*
 * the compaction, because the compacted magnitude is absolute — without this
 * a −274K% move would render without its minus.
 */
export function fmtPct(n: number | null | undefined, dp = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : n > 0 ? "+" : "";
  return `${sign}${fmtPctAbs(n, dp)}`;
}

/** Compact holder/volume counts. */
export function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function shortAddr(a: string | null | undefined, n = 4): string {
  if (!a) return "—";
  return `${a.slice(0, n)}…${a.slice(-n)}`;
}

/**
 * pump.fun symbols often already carry a leading "$" ("$YAPPING"), so naive
 * interpolation produces "$$YAPPING". Always render symbols through this.
 */
export function sym(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/^\$+/, "").trim() || s;
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Display formatting. Small numbers are the norm here — a fresh coin trades at 1e-7 SOL. */

export function fmtSol(n: number | null | undefined, dp = 3): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (a >= 1) return n.toFixed(dp);
  if (a >= 0.001) return n.toFixed(dp);
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** Price per token, which can be 1e-9 — switch to exponential below 1e-4. */
export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  if (Math.abs(n) < 1) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(4);
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

export function fmtPct(n: number | null | undefined, dp = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(dp)}%`;
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

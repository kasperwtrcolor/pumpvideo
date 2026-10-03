/**
 * Real holder counts, from RugCheck.
 *
 * Why this exists: pump.fun's API does not publish a holder count, so the
 * catalogue's `holders` column had nothing to fill it and every coin rendered
 * "0 holders" — a number that is not merely stale but structurally absent.
 * Solana's own RPC cannot answer it either: a holder count is a scan of every
 * token account for the mint, and the public endpoint caps `getProgramAccounts`
 * (a probe of BONK, which has ~900k holders, came back with 74 rows).
 *
 * RugCheck's public report is free, needs no key, and carries `totalHolders`
 * off its own index. It is by-mint, ~50-300ms, and tolerates a small burst —
 * measured at 10 sequential requests with no throttling.
 *
 * Counts move on the order of hours, so this is used as a slow refresh (the
 * keeper walks the catalogue round-robin), never on the request path.
 */

const BASE = "https://api.rugcheck.xyz/v1/tokens";
const TIMEOUT_MS = 12_000;

/**
 * Holder floor below which a coin is dust, not a token.
 *
 * Measured on 2026-10-03 across the live catalogue: 91% of coins (1,799 of 1,971
 * with a known count) and 92% of *freshly launched* tokens sit below 30 holders,
 * with a median of 2-3. Graduated coins run to the hundreds (SUPERPIG 553,
 * P2P 694, Mr Beast 2,393). So 30 is the line between "a handful of bots and the
 * dev" and "an actual holder base".
 *
 * It is deliberately NOT applied at ingest: 9 in 10 launches have <30 holders in
 * their first minutes, so gating on arrival would turn the New rail into a board
 * of things that already pumped and would never pick up a coin that starts tiny
 * and grows. It gates the *catalogue* instead, once a coin is older than an hour
 * (see `hideDust` in lib/retention.ts).
 */
export const MIN_HOLDERS = 30;


/** Holder count for one mint, or null when the report is unavailable. */
async function fetchHolders(mint: string): Promise<number | null> {
  try {
    const r = await fetch(`${BASE}/${mint}/report`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { totalHolders?: number };
    return typeof j.totalHolders === "number" && Number.isFinite(j.totalHolders)
      ? j.totalHolders
      : null;
  } catch {
    // Offline, timed out, or not indexed by RugCheck — all mean "no number",
    // and the caller keeps whatever it had rather than writing a zero.
    return null;
  }
}

/**
 * Resolve holder counts for many mints.
 *
 * Bounded concurrency rather than a flat Promise.all: a few hundred mints at
 * once is how a free endpoint starts returning 429, and a fixed worker pool
 * keeps the pressure predictable.
 *
 * Mints that fail are simply absent from the result — the caller must not read
 * absence as zero, or a RugCheck outage would blank every holder count in the
 * app.
 */
export async function holdersForMints(
  mints: string[],
  opts: { concurrency?: number; onMissing?: (mint: string) => void } = {},
): Promise<Map<string, number>> {
  const { concurrency = 5 } = opts;
  const queue = Array.from(new Set(mints.filter(Boolean)));
  const out = new Map<string, number>();
  if (queue.length === 0) return out;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const mint = queue[cursor++];
      const n = await fetchHolders(mint);
      if (n === null) opts.onMissing?.(mint);
      else out.set(mint, n);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()),
  );
  return out;
}

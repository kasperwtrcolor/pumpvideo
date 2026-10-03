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

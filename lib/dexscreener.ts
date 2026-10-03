/**
 * Dexscreener client — the by-mint price source that pump.fun doesn't have.
 *
 * Why this exists: pump.fun's v3 API has NO by-mint endpoint (`GET /coins/{mint}`
 * 404s for every mint), so the only way to refresh a coin was to page its ranked
 * list. On-curve coins churn out of that ranking within hours — the top on-curve
 * coin at time of writing had a market cap of only ~1,600 SOL, while thousands of
 * coins launch daily — so the market keeper silently refreshed nothing.
 *
 * Graduated coins are different: they hold a persistent AMM pool, so Dexscreener
 * indexes them permanently and answers by mint. That makes the graduated half of
 * the catalog reliably refreshable, which is also the half with real market caps.
 *
 * Free tier allows ~300 req/min, and the endpoint takes up to 30 mints per call.
 */

const BASE = "https://api.dexscreener.com/latest/dex/tokens";

export type DexPair = {
  dexId: string;
  priceNative?: string; // SOL per whole token (quote is SOL for pumpfun/pumpswap)
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
};

export type DexQuote = {
  mint: string;
  /** SOL per whole token. */
  priceSol: number;
  /** USD price, for sanity checks and display. */
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  /** Buys + sells over the trailing 24h. Recorded; no rail ranks on it now. */
  txns24h: number;
  change24hPct: number;
  /**
   * Net price move over the trailing 5 minutes, in percent. Dexscreener
   * computes this against its own tick history, which is finer-grained than the
   * keeper's 5-minute sampling, so it is the best 5-minute number available for
   * a graduated coin. Can be negative.
   */
  change5mPct: number;
  dexId: string;
};

/** Wrapped SOL — the quote token we want pairs priced against. */
const WSOL = "So11111111111111111111111111111111111111112";

/**
 * The SOL-quoted pair for each mint, or null where there is none.
 *
 * A mint can return several pairs (different venues, different quote tokens).
 * We only accept pairs quoted in SOL, because `priceNative` is meaningless
 * otherwise — an earlier probe of an on-curve coin returned a pair quoted in
 * another memecoin, so priceNative was "0.001628 TOAD", not SOL, and using it
 * would have written a price wrong by orders of magnitude.
 */
export async function fetchDexQuotes(
  mints: string[],
  opts: { batchSize?: number; attempts?: number } = {},
): Promise<Map<string, DexQuote>> {
  const { batchSize = 30, attempts = 3 } = opts;
  const out = new Map<string, DexQuote>();

  for (let i = 0; i < mints.length; i += batchSize) {
    const batch = mints.slice(i, i + batchSize);
    let pairs: DexPair[] | null = null;

    for (let attempt = 0; attempt < attempts && pairs === null; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1) + Math.random() * 300);
      try {
        const res = await fetch(`${BASE}/${batch.join(",")}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (res.status === 429 || res.status >= 500) continue; // transient
        if (!res.ok) break; // permanent
        const body = (await res.json()) as { pairs?: DexPair[] | null };
        pairs = body.pairs ?? [];
      } catch {
        // network blip — retry
      }
    }

    if (!pairs) continue;

    // Keep the deepest SOL-quoted pair per mint; thin/wrong-quote pairs are noise.
    const best = new Map<string, DexPair>();
    for (const p of pairs) {
      const mint = p.baseToken?.address;
      if (!mint) continue;
      if (p.quoteToken?.address !== WSOL) continue;
      const prev = best.get(mint);
      if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(mint, p);
    }

    for (const [mint, p] of best) {
      const priceSol = Number(p.priceNative);
      if (!Number.isFinite(priceSol) || priceSol <= 0) continue;
      out.set(mint, {
        mint,
        priceSol,
        priceUsd: Number(p.priceUsd) || 0,
        liquidityUsd: p.liquidity?.usd ?? 0,
        volume24hUsd: p.volume?.h24 ?? 0,
        txns24h: (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
        change24hPct: p.priceChange?.h24 ?? 0,
        change5mPct: p.priceChange?.m5 ?? 0,
        dexId: p.dexId,
      });
    }

    if (i + batchSize < mints.length) await sleep(250); // stay under the limiter
  }

  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

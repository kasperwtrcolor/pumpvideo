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
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  /** AMM pool address — stored on the coin so the app can link to the pool. */
  pairAddress?: string;
  /** Pool creation time, epoch ms. Used as the coin's launch proxy. */
  pairCreatedAt?: number;
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

// ---------------------------------------------------------------------------
// Trending board
// ---------------------------------------------------------------------------
//
// Dexscreener has NO trending endpoint. Its web "Trending" tab is rendered
// server-side and is not exposed by any public API — checked, repeatedly. The
// ONLY public list of what Dexscreener is actively pushing is the boost board
// (`token-boosts`), which is paid placement. So the board is the candidate set
// and a live trading filter is what makes the result mean "trending" rather
// than "someone paid for a slot": a boosted token qualifies only if it also
// shows real trailing-24h volume and liquidity. A promo nobody trades is
// dropped. This is a proxy, and it is labelled as one everywhere it surfaces.

const BOOSTS_TOP = "https://api.dexscreener.com/token-boosts/top/v1";
const BOOSTS_LATEST = "https://api.dexscreener.com/token-boosts/latest/v1";

type Boost = {
  chainId?: string;
  tokenAddress?: string;
  description?: string;
  icon?: string;
  header?: string;
  openGraph?: string;
  totalAmount?: number;
};

export type TrendToken = {
  mint: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  /** SOL per whole token. */
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  change24hPct: number;
  poolAddress: string | null;
  /** Pool creation time, used as the coin's launch proxy. */
  launchedAt: Date | null;
  /** Dexscreener's cumulative boost amount — the paid weight behind the slot. */
  boostAmount: number;
};

/** A boost's card image: its OpenGraph art, else rebuilt from the icon hash. */
function boostImage(b: Boost): string | null {
  if (b.openGraph) return b.openGraph;
  if (b.icon) {
    return `https://cdn.dexscreener.com/cms/images/${b.icon}?width=200&height=200&fit=crop&quality=95&format=auto`;
  }
  return null;
}

/** GET JSON with the same transient-error retry the rest of this file uses. */
async function getJson<T>(url: string, attempts = 3): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1) + Math.random() * 300);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) continue; // transient
      if (!res.ok) return null; // permanent
      return (await res.json()) as T;
    } catch {
      // network blip — retry
    }
  }
  return null;
}

/** Union of both boost boards, per Solana mint, keeping the larger amount. */
async function fetchBoosts(): Promise<Map<string, Boost>> {
  const [top, latest] = await Promise.all([
    getJson<Boost[]>(BOOSTS_TOP),
    getJson<Boost[]>(BOOSTS_LATEST),
  ]);
  const out = new Map<string, Boost>();
  for (const b of [...(top ?? []), ...(latest ?? [])]) {
    if (b.chainId !== "solana") continue;
    const mint = b.tokenAddress;
    if (!mint) continue;
    const prev = out.get(mint);
    if (!prev || (b.totalAmount ?? 0) > (prev.totalAmount ?? 0)) out.set(mint, b);
  }
  return out;
}

/** Pairs for up to `batchSize` mints per call (the endpoint's limit is 30). */
async function fetchPairsByMints(mints: string[], batchSize = 30): Promise<DexPair[]> {
  const all: DexPair[] = [];
  for (let i = 0; i < mints.length; i += batchSize) {
    const batch = mints.slice(i, i + batchSize);
    const body = await getJson<{ pairs?: DexPair[] | null }>(`${BASE}/${batch.join(",")}`);
    if (body?.pairs) all.push(...body.pairs);
    if (i + batchSize < mints.length) await sleep(250); // stay under the limiter
  }
  return all;
}

/** Deepest SOL-quoted pair per mint. Same selection rule as fetchDexQuotes. */
function bestSolPairs(pairs: DexPair[]): DexPair[] {
  const best = new Map<string, DexPair>();
  for (const p of pairs) {
    const mint = p.baseToken?.address;
    if (!mint) continue;
    if (p.quoteToken?.address !== WSOL) continue;
    const prev = best.get(mint);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(mint, p);
  }
  return [...best.values()];
}

/**
 * The tokens Dexscreener is trending *and* that are actually trading — see the
 * section header for why the boost board is the candidate set and the volume /
 * liquidity floors are what turn it into a trending list rather than a paid one.
 * Ordered by 24h volume, descending.
 */
export async function fetchTrending(opts: {
  minVolumeUsd?: number;
  minLiquidityUsd?: number;
} = {}): Promise<TrendToken[]> {
  const { minVolumeUsd = 25_000, minLiquidityUsd = 10_000 } = opts;

  const boosts = await fetchBoosts();
  if (boosts.size === 0) return [];

  const pairs = await fetchPairsByMints([...boosts.keys()]);

  const out: TrendToken[] = [];
  for (const p of bestSolPairs(pairs)) {
    const mint = p.baseToken?.address;
    const boost = mint ? boosts.get(mint) : undefined;
    if (!mint || !boost) continue;

    const volume24hUsd = p.volume?.h24 ?? 0;
    const liquidityUsd = p.liquidity?.usd ?? 0;
    if (volume24hUsd < minVolumeUsd || liquidityUsd < minLiquidityUsd) continue;

    const priceSol = Number(p.priceNative);
    if (!Number.isFinite(priceSol) || priceSol <= 0) continue;

    const symbol = p.baseToken?.symbol || mint.slice(0, 4);
    out.push({
      mint,
      symbol,
      name: p.baseToken?.name || symbol,
      imageUrl: boostImage(boost),
      priceSol,
      priceUsd: Number(p.priceUsd) || 0,
      marketCapUsd: p.marketCap ?? p.fdv ?? 0,
      liquidityUsd,
      volume24hUsd,
      change24hPct: p.priceChange?.h24 ?? 0,
      poolAddress: p.pairAddress ?? null,
      launchedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt) : null,
      boostAmount: boost.totalAmount ?? 0,
    });
  }

  out.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  return out;
}

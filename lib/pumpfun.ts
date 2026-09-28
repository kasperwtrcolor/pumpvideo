/**
 * Live market data client for pump.fun.
 *
 * Uses the public frontend API that the pump.fun UI itself calls. No key required.
 * We only ever read — all writes go through the practice engine or the live swap route.
 */

const FEED_API = "https://frontend-api-v3.pump.fun";
const UA = "Mozilla/5.0 (compatible; pumpclip/0.1)";

export type PumpCoin = {
  mint: string;
  name: string;
  symbol: string;
  description: string | null;
  image_uri: string | null;
  metadata_uri: string | null;
  creator: string | null;
  created_timestamp: number;
  complete: boolean;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_sol_reserves: number;
  total_supply: number;
  market_cap: number;
  pool_address: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  is_banned?: boolean;
  nsfw?: boolean;
};

type Sort =
  | "market_cap"
  | "created_timestamp"
  | "last_trade_timestamp"
  | "ath_market_cap"
  | "reply_count";

export async function fetchCoins(opts: {
  limit?: number;
  offset?: number;
  sort?: Sort;
  order?: "ASC" | "DESC";
} = {}): Promise<PumpCoin[]> {
  const { limit = 48, offset = 0, sort = "market_cap", order = "DESC" } = opts;
  const url = `${FEED_API}/coins?offset=${offset}&limit=${limit}&sort=${sort}&order=${order}&includeNsfw=false`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`pump.fun ${res.status}: ${await res.text()}`);
  return (await res.json()) as PumpCoin[];
}

/**
 * Fetch one coin by mint, or null when we can't find it.
 *
 * NOTE: pump.fun's v3 API has **no by-mint endpoint** — `GET /coins/{mint}`
 * 404s even for a mint that is demonstrably in the live list. So a single lookup
 * is a sweep of the ranked list. For more than one mint use
 * `fetchCoinsByMints()`, which sweeps once for the whole set.
 */
export async function fetchCoin(mint: string): Promise<PumpCoin | null> {
  const map = await fetchCoinsByMints([mint], { pages: 4 });
  return map.get(mint) ?? null;
}

/**
 * Resolve many mints in one sweep. Two passes:
 *   1. by market cap   — catches established coins
 *   2. by created time — catches brand-new coins that aren't ranked yet
 * Each pass pages until it runs out or has found everything it wants.
 *
 * Returns a Map of the mints it found. Mints absent from the result are not
 * refreshable through this API (they've fallen out of both rankings), and callers
 * should report that rather than pretend the sync succeeded.
 */
export async function fetchCoinsByMints(
  mints: string[],
  opts: { pages?: number; pageSize?: number } = {},
): Promise<Map<string, PumpCoin>> {
  const { pages = 4, pageSize = 50 } = opts;
  const want = new Set(mints);
  const found = new Map<string, PumpCoin>();
  if (want.size === 0) return found;

  const sweeps: Sort[] = ["market_cap", "created_timestamp"];

  for (const sort of sweeps) {
    for (let p = 0; p < pages; p++) {
      let batch: PumpCoin[];
      try {
        batch = await fetchCoins({ limit: pageSize, offset: p * pageSize, sort });
      } catch {
        break;
      }
      for (const c of batch) {
        if (want.has(c.mint)) found.set(c.mint, c);
      }
      if (batch.length < pageSize) break; // ranking exhausted
      if (found.size === want.size) return found;
      await sleep(120); // be a good citizen between pages
    }
    if (found.size === want.size) break;
  }

  return found;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Map an API record onto our Coin columns. */
export function toCoinRecord(c: PumpCoin) {
  const vSol = BigInt(Math.round(c.virtual_sol_reserves ?? 0));
  const vTok = BigInt(Math.round(c.virtual_token_reserves ?? 0));
  const supply = BigInt(Math.round(c.total_supply ?? 0));
  const wholeSupply = Number(supply) / 1e6;

  // Once a coin graduates to an AMM, pump.fun stops moving the virtual reserves
  // (they freeze at the "curve filled" sentinel) while `market_cap` keeps
  // tracking the real pool. Deriving price from frozen reserves would paint every
  // graduated coin with the same bogus number, so use the live market cap instead.
  const price =
    c.complete && wholeSupply > 0 && (c.market_cap ?? 0) > 0
      ? (c.market_cap as number) / wholeSupply
      : vTok > 0n
        ? Number(vSol) / 1e9 / (Number(vTok) / 1e6)
        : 0;

  return {
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    description: c.description || null,
    imageUrl: c.image_uri || null,
    virtualSol: vSol.toString(),
    virtualToken: vTok.toString(),
    realSol: BigInt(Math.round(c.real_sol_reserves ?? 0)).toString(),
    totalSupply: supply.toString(),
    priceSol: price,
    // Keep market cap *consistent with the price we display*. On the curve all
    // supply circulates, so derived is exact; graduated coins trade in a pool
    // where circulating < total, so the API's figure is the better one.
    marketCapSol: c.complete
      ? (c.market_cap ?? price * wholeSupply)
      : price * wholeSupply,
    complete: Boolean(c.complete),
    poolAddress: c.pool_address || null,
    creator: c.creator || null,
    twitter: c.twitter || null,
    telegram: c.telegram || null,
    website: c.website || null,
    launchedAt: c.created_timestamp ? new Date(c.created_timestamp) : null,
    lastSyncedAt: new Date(),
  };
}

/** Public RPC for read-only balance checks / live-mode plumbing. */
export const SOLANA_RPC =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

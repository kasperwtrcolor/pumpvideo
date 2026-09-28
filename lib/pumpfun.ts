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

/** Fetch one coin by mint, or null when pump.fun has never heard of it. */
export async function fetchCoin(mint: string): Promise<PumpCoin | null> {
  const res = await fetch(`${FEED_API}/coins/${mint}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pump.fun ${res.status}`);
  return (await res.json()) as PumpCoin;
}

/** Map an API record onto our Coin columns. */
export function toCoinRecord(c: PumpCoin) {
  const vSol = BigInt(Math.round(c.virtual_sol_reserves ?? 0));
  const vTok = BigInt(Math.round(c.virtual_token_reserves ?? 0));
  const supply = BigInt(Math.round(c.total_supply ?? 0));
  const price = vTok > 0n
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
    marketCapSol: c.market_cap ?? price * (Number(supply) / 1e6),
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

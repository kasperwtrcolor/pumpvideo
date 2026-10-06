/**
 * StonkFun — a second launch source, alongside pump.fun and Dexscreener.
 *
 * WHAT IT IS
 *
 * stonkfun.xyz is a Solana launchpad whose twist is that a coin is paired with
 * *anything* rather than SOL. Every launch we measured was paired with a
 * tokenized stock — NVDAX, TSLAX, OPENAI, SPCXX — so there is no SOL pair and
 * therefore no quote from Dexscreener's SOL-only path and no entry in pump.fun's
 * API. Those two facts are exactly why these coins are invisible to Pemp today:
 * not because they are untradeable, but because neither of our existing sources
 * can see them.
 *
 * WHY WE CAN SHOW THEM
 *
 * Jupiter routes the pool (measured: SOL -> token via BisonFi -> Manifest ->
 * Raydium Launchlab at ~0.02% impact for 0.01 SOL), so both the price and the
 * buy path already work through machinery the app has — `lib/jup-price.ts` for
 * the price, `/api/trade/live/*` for the swap. The only thing missing was a way
 * to *discover* them, which is what this file adds.
 *
 * THE API
 *
 * `GET /api/launches` is a public, keyless JSON endpoint the site's own frontend
 * calls. It returns the latest 100 launches and ignores paging parameters — it
 * is a fixed rolling window, not a paginated feed — so the correct way to use it
 * is to poll it. Measured 2026-10-06: 100 launches spanned ~47 minutes, i.e.
 * roughly 127/hour. That volume is why ingestion is gated (see `ingestStonkfun`
 * in lib/ingest.ts) rather than taken wholesale.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_RPC } from "./pumpfun";

const API = "https://www.stonkfun.xyz/api/launches";
const UA = "Mozilla/5.0 (compatible; pemp/0.1)";

export type StonkLaunch = {
  mint: string;
  /** The launchpad pool account. Stored as the coin's `poolAddress`. */
  pool: string | null;
  name: string;
  symbol: string;
  logoUrl: string | null;
  /** What the coin is paired against — a stock token, not SOL. */
  quoteMint: string | null;
  quoteSymbol: string | null;
  creator: string | null;
  startMarketCapUsd: number;
  createdAt: Date | null;
};

type RawLaunch = {
  mint?: string;
  pool?: string;
  name?: string;
  symbol?: string;
  logoUrl?: string;
  quoteMint?: string;
  quoteSymbol?: string;
  creator?: string;
  startMarketCapUsd?: number;
  createdAt?: string;
};

/**
 * The latest launches, newest first.
 *
 * Throws on a non-OK response rather than returning an empty list: an unreadable
 * board and an empty board must not look the same to the caller, and this is the
 * one lesson every other ingest path in this repo has already learned the hard
 * way (see the same note on lib/pumpfun.ts#fetchCoins).
 */
export async function fetchStonkLaunches(
  opts: { attempts?: number } = {},
): Promise<StonkLaunch[]> {
  const { attempts = 3 } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1) + Math.random() * 300);
    try {
      const res = await fetch(API, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`stonkfun ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`stonkfun ${res.status}`);
      const body = (await res.json()) as { launches?: RawLaunch[] };
      return (body.launches ?? [])
        .filter((l): l is RawLaunch & { mint: string } => Boolean(l?.mint))
        .map((l) => ({
          mint: l.mint,
          pool: l.pool ?? null,
          name: (l.name || l.symbol || l.mint.slice(0, 6)).trim(),
          symbol: (l.symbol || l.mint.slice(0, 6)).trim(),
          logoUrl: l.logoUrl ?? null,
          quoteMint: l.quoteMint ?? null,
          quoteSymbol: l.quoteSymbol ?? null,
          creator: l.creator ?? null,
          startMarketCapUsd: Number(l.startMarketCapUsd) || 0,
          createdAt: l.createdAt ? new Date(l.createdAt) : null,
        }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("stonkfun: unreachable");
}

/**
 * Raw on-chain supply, normalised to 6 decimals.
 *
 * `Coin.totalSupply` is stored as raw integer units at a fixed 6 decimals (see
 * `wholeSupply` in lib/keeper.ts, which divides by 1e6), so a mint with any
 * other precision has to be scaled to that convention or every derived market
 * cap is wrong by orders of magnitude. Every StonkFun launch measured so far is
 * 1e9 whole tokens at 6 decimals, but the API publishes no supply at all — only
 * a launch-time market cap — so this reads the mint directly rather than
 * assuming.
 *
 * Returns null when the mint cannot be read, which the caller treats as "do not
 * ingest": a coin whose supply is unknown cannot be given a market cap.
 */
export async function fetchTokenSupplyRaw(mint: string): Promise<string | null> {
  try {
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const s = await conn.getTokenSupply(new PublicKey(mint));
    const raw = BigInt(s.value.amount);
    const decimals = s.value.decimals;
    const scaled =
      decimals === 6
        ? raw
        : decimals < 6
          ? raw * 10n ** BigInt(6 - decimals)
          : raw / 10n ** BigInt(decimals - 6);
    return scaled > 0n ? scaled.toString() : null;
  } catch {
    return null;
  }
}

/** One line describing what the coin is paired with, used as the clip caption. */
export function stonkCaption(l: StonkLaunch): string {
  return l.quoteSymbol ? `paired with ${l.quoteSymbol}` : l.name;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

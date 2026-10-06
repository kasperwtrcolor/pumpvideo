/**
 * Jupiter price API (v3) — a by-mint price for the coins Dexscreener cannot see.
 *
 * WHY THIS EXISTS
 *
 * Dexscreener only indexes tokens that hold an AMM pool, so a pump.fun coin
 * still on its bonding curve has no pair and no price from it (see the WSOL
 * filter in lib/dexscreener.ts — the deeper problem is that the pair simply does
 * not exist yet). pump.fun's own API has no by-mint endpoint either
 * (`GET /coins/{mint}` 404s for every mint, per lib/pumpfun.ts), so the keeper
 * could only price an on-curve coin while it happened to sit inside pump.fun's
 * ranked list — and on-curve coins churn out of a 1000-deep ranking within
 * hours. The result was a large slice of the catalogue showing a frozen price
 * and a frozen 24h move: a number that is worse than useless on a buy screen,
 * because a user reads it as the current value of what they are about to buy.
 *
 * Jupiter routes pump.fun's bonding curve, so it prices an on-curve token by
 * mint, in USD, in bulk. That completes the price story: Dexscreener for
 * anything with a pool, Jupiter for everything else. Between the two, every
 * coin the app shows has a price it can stand behind.
 *
 * PRICE IS IN USD, the weird bit
 *
 * Everywhere else in this codebase a price is SOL (priceSol), because that is
 * what a swap is denominated in. Jupiter publishes USD, so the caller converts
 * with the same `solUsd()` the rest of the keeper uses — one conversion, in one
 * place (lib/keeper.ts), rather than a second notion of price living here.
 *
 * The keyless host is `lite-api.jup.ag`; measured, it accepts a full batch of
 * 50 ids and answers in well under a second.
 */

const BASE = "https://lite-api.jup.ag/price/v3";

/** How many mints one request may carry. 50 is the documented and measured cap. */
const MAX_IDS = 50;

export type JupPrice = {
  mint: string;
  /** USD per whole token, as published. */
  usdPrice: number;
  liquidityUsd: number;
  /** Jupiter's own trailing-24h change, or null when it does not publish one. */
  change24hPct: number | null;
};

type JupRow = {
  usdPrice?: number | string | null;
  liquidity?: number | string | null;
  priceChange24h?: number | string | null;
};

/**
 * Price many mints in as few calls as the API allows.
 *
 * A mint absent from the result has no price Jupiter can quote — no route, no
 * liquidity, or a mint that does not exist. That is a real answer and the caller
 * treats it as one: an unpriced coin is not shown with a made-up number.
 */
export async function fetchJupPrices(
  mints: string[],
  opts: { batchSize?: number; attempts?: number } = {},
): Promise<Map<string, JupPrice>> {
  const { batchSize = MAX_IDS, attempts = 3 } = opts;
  const out = new Map<string, JupPrice>();
  const unique = [...new Set(mints)];

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    let body: Record<string, JupRow> | null = null;

    for (let attempt = 0; attempt < attempts && body === null; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1) + Math.random() * 300);
      try {
        const res = await fetch(`${BASE}?ids=${batch.join(",")}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 429 || res.status >= 500) continue; // transient
        if (!res.ok) break; // permanent
        body = (await res.json()) as Record<string, JupRow>;
      } catch {
        // network blip — retry
      }
    }
    if (!body) continue;

    for (const mint of batch) {
      const row = body[mint];
      const usdPrice = Number(row?.usdPrice);
      // 0 or null means "Jupiter has no price", not "the price is zero". Skipping
      // keeps the caller from writing a zero price onto a live coin.
      if (!Number.isFinite(usdPrice) || usdPrice <= 0) continue;
      const chg = Number(row?.priceChange24h);
      out.set(mint, {
        mint,
        usdPrice,
        liquidityUsd: Number(row?.liquidity) || 0,
        change24hPct: Number.isFinite(chg) ? chg : null,
      });
    }

    if (i + batchSize < unique.length) await sleep(250); // stay polite
  }

  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

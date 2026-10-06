import { fetchDexQuotes } from "./dexscreener";
import { fetchJupPrices } from "./jup-price";
import { solUsd } from "./sol-price";
import { prisma } from "./db";
import { TOKENS_PER_UNIT } from "./bonding-curve";

/**
 * Live per-mint quotes for the feed's price ticker.
 *
 * Two sources, layered:
 *
 *  1. The market keeper's last write to `Coin`. Always present, but only as
 *     fresh as the keeper's cadence (minutes).
 *  2. DexScreener, which answers by mint and is genuinely live — but only
 *     indexes coins that hold a pool. On-curve launches have no pool yet, so
 *     for them the keeper's number is the best that exists.
 *
 * The result is cached briefly per mint. The client polls every ~12s and the
 * feed only asks about the clips near the viewport, so a short TTL keeps the
 * DexScreener call rate low without making the ticker feel frozen.
 */

/** How long a mint's quote is reused before it is refetched. */
const TTL = 12_000;

/** How many mints one request may ask about, so a hostile query can't fan out. */
const MAX_MINTS = 60;

type Entry = {
  priceSol: number;
  marketCapSol: number;
  change24hPct: number;
  /** True when DexScreener answered for this mint, false when it is the keeper's cached number. */
  live: boolean;
  at: number;
};

const cache = new Map<string, Entry>();

export type Quote = {
  priceSol: number;
  marketCapSol: number;
  change24hPct: number;
  live: boolean;
};

/** SPL mints are 32–44 base58 characters; anything else is not worth a round trip. */
function looksLikeMint(s: string): boolean {
  return s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

export async function quotesFor(mints: string[]): Promise<Record<string, Quote>> {
  const now = Date.now();
  const unique = Array.from(new Set(mints.filter(looksLikeMint))).slice(0, MAX_MINTS);
  const out: Record<string, Quote> = {};
  if (unique.length === 0) return out;

  const stale: string[] = [];
  for (const m of unique) {
    const hit = cache.get(m);
    if (hit && now - hit.at < TTL) {
      out[m] = { priceSol: hit.priceSol, marketCapSol: hit.marketCapSol, change24hPct: hit.change24hPct, live: hit.live };
    } else {
      stale.push(m);
    }
  }
  if (stale.length === 0) return out;

  // Base layer: whatever the keeper last wrote. One query for the whole batch.
  const rows = await prisma.coin.findMany({
    where: { mint: { in: stale } },
    select: { mint: true, priceSol: true, marketCapSol: true, change24hPct: true, totalSupply: true },
  });
  const base = new Map(rows.map((r) => [r.mint, r]));

  // Live layer: best effort. A DexScreener outage must degrade to the keeper's
  // numbers, not fail the ticker.
  let live: Awaited<ReturnType<typeof fetchDexQuotes>> = new Map();
  try {
    live = await fetchDexQuotes(stale);
  } catch {
    /* fall through to the base layer */
  }

  // Jupiter fills in everything Dexscreener structurally cannot see: on-curve
  // coins (no AMM pool yet) and coins whose pool is not quoted in SOL at all —
  // StonkFun pairs with tokenized stocks, so its coins have no SOL pair and would
  // otherwise sit frozen at the keeper's five-minute price while every pump.fun
  // coin beside them ticked. Same source the keeper uses, so the ticker and the
  // stored price agree.
  const unseen = stale.filter((m) => !live.has(m));
  let jup: Awaited<ReturnType<typeof fetchJupPrices>> = new Map();
  if (unseen.length > 0) {
    try {
      jup = await fetchJupPrices(unseen);
    } catch {
      /* fall through to the base layer */
    }
  }
  // Jupiter publishes USD; everything downstream is SOL.
  const usd = jup.size > 0 ? await solUsd().catch(() => 0) : 0;

  for (const m of stale) {
    const b = base.get(m);
    const l = live.get(m);
    const j = jup.get(m);
    let entry: Entry | null = null;

    if (l && Number.isFinite(l.priceSol) && l.priceSol > 0) {
      // Market cap = price x supply. Deriving it from supply rather than scaling
      // the stored cap keeps it correct even when the stored price is stale —
      // in which case scaling would have carried the staleness through.
      const supply = b ? Number(b.totalSupply) / Number(TOKENS_PER_UNIT) : 0;
      const marketCapSol =
        supply > 0
          ? l.priceSol * supply
          : b && b.priceSol > 0
            ? b.marketCapSol * (l.priceSol / b.priceSol)
            : 0;
      entry = {
        priceSol: l.priceSol,
        marketCapSol,
        change24hPct: Number.isFinite(l.change24hPct) ? l.change24hPct : (b?.change24hPct ?? 0),
        live: true,
        at: now,
      };
    } else if (j && Number.isFinite(j.usdPrice) && j.usdPrice > 0 && usd > 0) {
      const priceSol = j.usdPrice / usd;
      const supply = b ? Number(b.totalSupply) / Number(TOKENS_PER_UNIT) : 0;
      entry = {
        priceSol,
        marketCapSol: supply > 0 ? priceSol * supply : (b?.marketCapSol ?? 0),
        change24hPct: j.change24hPct ?? b?.change24hPct ?? 0,
        live: true,
        at: now,
      };
    } else if (b) {
      entry = {
        priceSol: b.priceSol,
        marketCapSol: b.marketCapSol,
        change24hPct: b.change24hPct,
        live: false,
        at: now,
      };
    }

    if (entry) {
      cache.set(m, entry);
      out[m] = {
        priceSol: entry.priceSol,
        marketCapSol: entry.marketCapSol,
        change24hPct: entry.change24hPct,
        live: entry.live,
      };
    }
  }

  return out;
}

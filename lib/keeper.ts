/**
 * The market keeper — ONE implementation, shared by:
 *   - scripts/sync.ts        (the 5-minute VPS cron)
 *   - app/api/sync/route.ts  (POST from the app, GET from Vercel Cron)
 *
 * These used to be two near-identical copies, which is how a "keeper" that
 * refreshed nothing managed to look healthy in one place and broken in the
 * other. All refresh logic lives here now.
 *
 * The keeper does two jobs per tick:
 *
 *   1. refresh prices for the catalog (below), and
 *   2. ingest newly launched tokens (opt-in, `opts.ingest`), so the feed is
 *      not a frozen snapshot of whatever was popular the day it was seeded.
 *      Ingest runs first, so coins it discovers get a price on the same tick.
 *
 * Price refresh needs two sources, because one cannot cover the catalog:
 *
 *   graduated coins -> Dexscreener, by mint, batched 30/call.
 *     They hold a persistent AMM pool, so they are indexed permanently and are
 *     the coins with real market caps. This is the reliable path.
 *
 *   on-curve coins  -> pump.fun ranked-list sweep.
 *     pump.fun has no by-mint endpoint, so this is the only option, and it only
 *     works while a coin is still ranked. On-curve coins churn out within hours
 *     (thousands launch daily), so a low notFound rate here is expected, not a
 *     bug. Reported honestly rather than hidden.
 */
import { prisma } from "./db";
import { fetchCoinsByMints, toCoinRecord } from "./pumpfun";
import { fetchDexQuotes } from "./dexscreener";
import { ingestNewTokens } from "./ingest";
import { reconcilePositions } from "./reconcile";
import type { ReconcileResult } from "./reconcile";
import { solUsd } from "./sol-price";
import { VISIBLE_COIN } from "./visibility";

export type SyncResult = {
  ok: boolean;
  checked: number;
  updated: number;
  notFound: number;
  viaDex: number;
  viaPumpfun: number;
  errors: string[];
  sweepErrors: string[];
  note?: string;
  /** Present only when an ingest step ran — see `opts.ingest`. */
  ingested?: {
    considered: number;
    coins: number;
    clips: number;
    skipped: number;
  };
  /** Positions brought back in step with the chain, or null if the pass failed. */
  reconciled: ReconcileResult | null;
};

/** totalSupply is raw units with 6 decimals. */
function wholeSupply(totalSupply: string): number {
  const n = Number(totalSupply);
  return Number.isFinite(n) && n > 0 ? n / 1e6 : 0;
}

/**
 * Trailing window used to score volatility, in ms.
 *
 * Deliberately 10 minutes, not 5. The keeper samples every 5 minutes, so a
 * strict 5-minute window can hold at most one step — and a coin that ran up and
 * gave it back between two samples would score as if it never moved. Two steps
 * is the shortest window in which a reversal is actually observable, which is
 * the entire point of the Hot ranking ("gained *and* lost").
 */
const VOLATILITY_WINDOW_MS = 10 * 60_000;

/** How far back samples are fetched — the volatility window plus one boundary. */
const SAMPLE_LOOKBACK_MS = 15 * 60_000;

type Sample = { price: number; at: Date };

/**
 * Volatility score: the sum of absolute step moves across the trailing window,
 * in percent.
 *
 * A straight run of +10% scores 10. A round trip (+10%, then −10%) scores ≈20,
 * because both legs are counted — which is what lifts the coins that gained and
 * lost above the ones that merely drifted the same distance one way. The price
 * just measured is appended as the final step, so the newest move always counts
 * even before it has been written to PricePoint.
 */
function volatility(samples: Sample[], currentPrice: number): number {
  const cutoff = Date.now() - VOLATILITY_WINDOW_MS;
  const series = [
    ...samples.filter((s) => s.at.getTime() >= cutoff).map((s) => s.price),
    currentPrice,
  ].filter((p) => Number.isFinite(p) && p > 0);

  let sum = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev > 0) sum += Math.abs((series[i] - prev) / prev) * 100;
  }
  return sum;
}

/**
 * Net percent change from the sample nearest 5 minutes back, or 0 when no sample
 * that old exists yet (a coin ingested less than 5 minutes ago).
 *
 * `samples` is ascending by time, so the loop leaves `base` holding the newest
 * sample at or before the 5-minute mark — which, at a 5-minute cadence, is
 * exactly the previous tick.
 */
function changeOver5m(samples: Sample[], currentPrice: number): number {
  const target = Date.now() - 5 * 60_000;
  let base: number | null = null;
  for (const s of samples) {
    if (s.at.getTime() <= target) base = s.price;
  }
  if (base === null || !(base > 0)) return 0;
  return ((currentPrice - base) / base) * 100;
}

export async function runKeeper(opts: {
  mints?: string[];
  limit: number;
  /**
   * How many freshly launched coins to consider for ingestion, or 0/undefined
   * to skip. Off by default: the HTTP route shares this function, and a
   * serverless invocation should not be pulling thousands of new coins off
   * pump.fun. The VPS cron opts in (see scripts/sync-cron.sh).
   */
  ingest?: number;
  /**
   * How many positions to reconcile against the chain, or 0/undefined to skip.
   * Off by default for the same reason as `ingest`: one RPC read per position
   * does not belong inside a 60-second serverless invocation. The VPS cron opts
   * in (see scripts/sync-cron.sh).
   */
  reconcile?: number;
}): Promise<SyncResult> {
  // Ingest runs FIRST, so coins discovered on this tick are part of the catalog
  // that the refresh below walks — they get a real price immediately instead of
  // waiting five minutes for the next tick.
  //
  // Its own try/catch: pump.fun rate-limits hard, and a failed ingest must not
  // turn a perfectly good price refresh into a failed sync. A targeted `mints`
  // refresh is a repair, not a discovery pass, so it never ingests.
  const errors: string[] = [];
  let ingested: SyncResult["ingested"];
  if (!opts.mints?.length && opts.ingest && opts.ingest > 0) {
    try {
      ingested = await ingestNewTokens({ limit: opts.ingest });
    } catch (e) {
      errors.push(`ingest: ${(e as Error).message.slice(0, 90)}`);
    }
  }

  // ---- positions ----------------------------------------------------------
  // The wallet is the authority on what is held, and this runs before the
  // catalog is even read: a book listing coins the wallet no longer has is
  // wrong regardless of what the market did this tick.
  //
  // A position mirror maintained only from our own fill log drifts the first
  // time a wallet moves without us — a swap on pump.fun directly, a transfer
  // out — and can never come back, because it is arithmetic on our own history.
  // Reconciling against the chain means the book heals even for someone who
  // never trades through the app again.
  const reconciled = opts.reconcile
    ? await reconcilePositions({ apply: true, limit: opts.reconcile }).catch(() => null)
    : null;

  const coins = opts.mints?.length
    ? await prisma.coin.findMany({ where: { mint: { in: opts.mints } } })
    : await prisma.coin.findMany({
        where: { ...VISIBLE_COIN },
        orderBy: { marketCapSol: "desc" },
        take: opts.limit,
      });

  const empty: SyncResult = {
    ok: true,
    checked: 0,
    updated: 0,
    notFound: 0,
    viaDex: 0,
    viaPumpfun: 0,
    errors,
    sweepErrors: [],
    ingested,
    reconciled,
  };
  if (coins.length === 0) return empty;

  // Recent price samples, fetched once for the whole catalog. Scoring volatility
  // per coin would be one query per coin per tick (hundreds of round trips);
  // this is a single indexed range read, grouped in memory below. It is read
  // *before* the update loop, so it holds the state up to the previous tick —
  // exactly the history the step calculation needs, with this tick's price
  // appended in `volatility()` rather than already present twice.
  const recentPoints = await prisma.pricePoint.findMany({
    where: {
      coinId: { in: coins.map((c) => c.id) },
      at: { gte: new Date(Date.now() - SAMPLE_LOOKBACK_MS) },
    },
    orderBy: { at: "asc" },
    select: { coinId: true, priceSol: true, at: true },
  });
  const historyByCoin = new Map<string, Sample[]>();
  for (const p of recentPoints) {
    const arr = historyByCoin.get(p.coinId) ?? [];
    arr.push({ price: p.priceSol, at: p.at });
    historyByCoin.set(p.coinId, arr);
  }

  const graduated = coins.filter((c) => c.complete);
  const onCurve = coins.filter((c) => !c.complete);

  const sweepErrors: string[] = [];
  let updated = 0;
  let notFound = 0;
  let viaDex = 0;
  let viaPumpfun = 0;

  const usd = await solUsd().catch(() => 0);

  // ---- graduated: Dexscreener by mint -------------------------------------
  const dexQuotes =
    graduated.length > 0
      ? await fetchDexQuotes(graduated.map((c) => c.mint)).catch(() => new Map())
      : new Map();

  for (const coin of graduated) {
    const q = dexQuotes.get(coin.mint);
    if (!q) {
      notFound++;
      continue;
    }
    try {
      const supply = wholeSupply(coin.totalSupply);
      const marketCapSol = supply > 0 ? q.priceSol * supply : coin.marketCapSol;
      const history = historyByCoin.get(coin.id) ?? [];

      // Graduated coins get Dexscreener's native 5-minute number, which is
      // computed against a finer tick history than our own sampling. Our own
      // sample delta is the fallback for the rare pair Dexscreener returns
      // without an `m5` (0 is ambiguous, so treat it as "unmeasured").
      const change5mPct =
        q.change5mPct !== 0 ? q.change5mPct : changeOver5m(history, q.priceSol);

      await prisma.coin.update({
        where: { id: coin.id },
        data: {
          priceSol: q.priceSol,
          marketCapSol,
          change24hPct: q.change24hPct,
          change5mPct,
          // Never below the plain 5-minute move: when our own samples are too
          // sparse or too fresh to show a step (a coin the keeper first saw
          // minutes ago), Dexscreener's m5 still tells us it moved this much.
          // The step sum wins when it is larger, i.e. when the price reversed.
          volatility5m: Math.max(volatility(history, q.priceSol), Math.abs(change5mPct)),
          volume24hSol: usd > 0 ? q.volume24hUsd / usd : coin.volume24hSol,
          lastSyncedAt: new Date(),
        },
      });
      await prisma.pricePoint.create({
        data: { coinId: coin.id, priceSol: q.priceSol, marketCapSol },
      });
      updated++;
      viaDex++;
    } catch (e) {
      errors.push(`${coin.symbol}: ${(e as Error).message.slice(0, 70)}`);
    }
  }

  // ---- on-curve: pump.fun ranked sweep ------------------------------------
  if (onCurve.length > 0) {
    const live = await fetchCoinsByMints(
      onCurve.map((c) => c.mint),
      { errors: sweepErrors },
    );

    for (const coin of onCurve) {
      const record = live.get(coin.mint);
      if (!record) {
        notFound++;
        continue;
      }
      try {
        const mapped = toCoinRecord(record);

        const since24h = await prisma.pricePoint.findFirst({
          where: { coinId: coin.id, at: { lte: new Date(Date.now() - 23 * 3600_000) } },
          orderBy: { at: "desc" },
        });
        const baseline =
          since24h ??
          (await prisma.pricePoint.findFirst({
            where: { coinId: coin.id },
            orderBy: { at: "asc" },
          }));

        const change24hPct =
          baseline && baseline.priceSol > 0
            ? ((mapped.priceSol - baseline.priceSol) / baseline.priceSol) * 100
            : coin.change24hPct;

        // On-curve coins have no Dexscreener pair, so both numbers come from our
        // own samples — which at a 5-minute cadence is precisely the 5-minute
        // change.
        const history = historyByCoin.get(coin.id) ?? [];
        const change5mPct = changeOver5m(history, mapped.priceSol);

        await prisma.coin.update({
          where: { id: coin.id },
          data: {
            ...mapped,
            change24hPct,
            change5mPct,
            volatility5m: Math.max(volatility(history, mapped.priceSol), Math.abs(change5mPct)),
            isBanned: Boolean(record.is_banned),
            lastSyncedAt: new Date(),
          },
        });
        await prisma.pricePoint.create({
          data: {
            coinId: coin.id,
            priceSol: mapped.priceSol,
            marketCapSol: mapped.marketCapSol,
          },
        });
        updated++;
        viaPumpfun++;
      } catch (e) {
        errors.push(`${coin.symbol}: ${(e as Error).message.slice(0, 70)}`);
      }
    }
  }

  let note: string | undefined;
  if (updated === 0 && coins.length > 0) {
    note = sweepErrors.length
      ? "pump.fun rate-limited the sweep — transient, will retry next tick"
      : "no coin resolved — the catalog has gone stale";
  }

  // ---- ingest -------------------------------------------------------------
  // Already ran, above, before the catalog was read.

  return {
    ok: true,
    checked: coins.length,
    updated,
    notFound,
    viaDex,
    viaPumpfun,
    errors: errors.slice(0, 5),
    sweepErrors: sweepErrors.slice(0, 5),
    note,
    ingested,
    reconciled,
  };
}

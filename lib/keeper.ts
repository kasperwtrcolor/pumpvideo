/**
 * The market keeper — ONE implementation, shared by:
 *   - scripts/sync.ts        (the 5-minute VPS cron)
 *   - app/api/sync/route.ts  (POST from the app, GET from Vercel Cron)
 *
 * These used to be two near-identical copies, which is how a "keeper" that
 * refreshed nothing managed to look healthy in one place and broken in the
 * other. All refresh logic lives here now.
 *
 * Two sources, because one cannot cover the catalog:
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
import { solUsd } from "./sol-price";

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
};

/** totalSupply is raw units with 6 decimals. */
function wholeSupply(totalSupply: string): number {
  const n = Number(totalSupply);
  return Number.isFinite(n) && n > 0 ? n / 1e6 : 0;
}

export async function runKeeper(opts: { mints?: string[]; limit: number }): Promise<SyncResult> {
  const coins = opts.mints?.length
    ? await prisma.coin.findMany({ where: { mint: { in: opts.mints } } })
    : await prisma.coin.findMany({
        where: { isBanned: false },
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
    errors: [],
    sweepErrors: [],
  };
  if (coins.length === 0) return empty;

  const graduated = coins.filter((c) => c.complete);
  const onCurve = coins.filter((c) => !c.complete);

  const errors: string[] = [];
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

      await prisma.coin.update({
        where: { id: coin.id },
        data: {
          priceSol: q.priceSol,
          marketCapSol,
          change24hPct: q.change24hPct,
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

        await prisma.coin.update({
          where: { id: coin.id },
          data: {
            ...mapped,
            change24hPct,
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
  };
}

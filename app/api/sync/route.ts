import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";
import { fetchCoin, toCoinRecord } from "@/lib/pumpfun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sync   { mints?: string[], limit?: number }
 *
 * The market keeper. Pulls fresh reserves from pump.fun for the coins in play,
 * writes a PricePoint, and recomputes 24h change from that history.
 *
 * In production this is a cron job; the endpoint exists so the app can also
 * self-heal on load without a scheduler. It is idempotent and safe to spam.
 */
export async function POST(req: NextRequest) {
  let mints: string[] | undefined;
  let limit = 24;
  try {
    const body = (await req.json()) as { mints?: string[]; limit?: number };
    mints = body.mints?.slice(0, 40);
    if (body.limit) limit = Math.min(40, Math.max(1, body.limit));
  } catch {
    // empty body is fine
  }

  const coins = mints?.length
    ? await prisma.coin.findMany({ where: { mint: { in: mints } } })
    : await prisma.coin.findMany({
        where: { isBanned: false, complete: false },
        orderBy: { marketCapSol: "desc" },
        take: limit,
      });

  let updated = 0;
  const errors: string[] = [];

  for (const coin of coins) {
    try {
      const live = await fetchCoin(coin.mint);
      if (!live) continue;
      const record = toCoinRecord(live);

      const since24h = await prisma.pricePoint.findFirst({
        where: {
          coinId: coin.id,
          at: { lte: new Date(Date.now() - 23 * 3600_000) },
        },
        orderBy: { at: "desc" },
      });
      const baseline = since24h ?? (await prisma.pricePoint.findFirst({
        where: { coinId: coin.id },
        orderBy: { at: "asc" },
      }));

      const change24hPct =
        baseline && baseline.priceSol > 0
          ? ((record.priceSol - baseline.priceSol) / baseline.priceSol) * 100
          : coin.change24hPct;

      await prisma.coin.update({
        where: { id: coin.id },
        data: { ...record, change24hPct, isBanned: Boolean(live.is_banned) },
      });
      await prisma.pricePoint.create({
        data: {
          coinId: coin.id,
          priceSol: record.priceSol,
          marketCapSol: record.marketCapSol,
        },
      });
      updated++;
    } catch (e) {
      errors.push(`${coin.symbol}: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  return withTrader({ ok: true, checked: coins.length, updated, errors: errors.slice(0, 5) });
}

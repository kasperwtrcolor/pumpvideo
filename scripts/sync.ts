/**
 * Market keeper (cron entry point).
 *
 *   npx tsx scripts/sync.ts [--limit 40]
 *
 * Pulls fresh reserves for the coins in play and appends PricePoints, so the
 * 24h change chip and PnL marks stay honest. Same logic as POST /api/sync —
 * this variant exists so a scheduler can run it without an HTTP round trip.
 *
 * Cron (every 5 minutes):
 *   cd /srv/pumpclip && npx tsx scripts/sync.ts --limit 40
 */
import { prisma } from "../lib/db";
import { fetchCoin, toCoinRecord } from "../lib/pumpfun";

const i = process.argv.indexOf("--limit");
const LIMIT = i === -1 ? 40 : Number(process.argv[i + 1]) || 40;

async function main() {
  const coins = await prisma.coin.findMany({
    where: { isBanned: false, complete: false },
    orderBy: { marketCapSol: "desc" },
    take: LIMIT,
  });

  let updated = 0;
  const errors: string[] = [];

  for (const coin of coins) {
    try {
      const live = await fetchCoin(coin.mint);
      if (!live) continue;
      const record = toCoinRecord(live);

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
      errors.push(`${coin.symbol}: ${(e as Error).message.slice(0, 70)}`);
    }
  }

  console.log(`sync: checked ${coins.length}, updated ${updated}`);
  if (errors.length) console.log(`errors (${errors.length}): ${errors.slice(0, 5).join(" | ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

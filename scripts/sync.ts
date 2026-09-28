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
import { fetchCoinsByMints, toCoinRecord } from "../lib/pumpfun";

const i = process.argv.indexOf("--limit");
const LIMIT = i === -1 ? 40 : Number(process.argv[i + 1]) || 40;

async function main() {
  const coins = await prisma.coin.findMany({
    where: { isBanned: false, complete: false },
    orderBy: { marketCapSol: "desc" },
    take: LIMIT,
  });

  // One list sweep resolves every mint — pump.fun has no by-mint endpoint.
  const live = await fetchCoinsByMints(coins.map((c) => c.mint));

  let updated = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (const coin of coins) {
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
        data: { ...mapped, change24hPct, isBanned: Boolean(record.is_banned) },
      });
      await prisma.pricePoint.create({
        data: {
          coinId: coin.id,
          priceSol: mapped.priceSol,
          marketCapSol: mapped.marketCapSol,
        },
      });
      updated++;
    } catch (e) {
      errors.push(`${coin.symbol}: ${(e as Error).message.slice(0, 70)}`);
    }
  }

  console.log(
    `sync: checked ${coins.length}, updated ${updated}, notFound ${notFound}`,
  );
  if (errors.length) console.log(`errors (${errors.length}): ${errors.slice(0, 5).join(" | ")}`);
  if (updated === 0 && coins.length > 0) {
    console.log("WARNING: nothing updated — the keeper is not doing its job.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

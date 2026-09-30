/**
 * Diagnostic: does the market keeper's read path actually work?
 *
 *   npx tsx scripts/diag-sync.ts
 *
 * `updated: 0` with an empty `errors` array is the dangerous case — it means the
 * keeper silently did nothing. This checks the sweep directly.
 */
import { prisma } from "../lib/db";
import { fetchCoinsByMints, fetchCoins, toCoinRecord } from "../lib/pumpfun";
import { VISIBLE_COIN } from "../lib/visibility";

async function main() {
  const coins = await prisma.coin.findMany({
    where: { ...VISIBLE_COIN, complete: false },
    orderBy: { marketCapSol: "desc" },
    take: 10,
  });

  console.log(`on-curve coins in DB: ${coins.length}`);
  const live = await fetchCoinsByMints(coins.map((c) => c.mint));
  console.log(`sweep resolved ${live.size}/${coins.length}\n`);

  for (const c of coins) {
    const rec = live.get(c.mint);
    if (!rec) {
      console.log(`  ${c.symbol.padEnd(12)} NOT FOUND in rankings`);
      continue;
    }
    const mapped = toCoinRecord(rec);
    const drift =
      c.priceSol > 0
        ? (((mapped.priceSol - c.priceSol) / c.priceSol) * 100).toFixed(2)
        : "n/a";
    console.log(
      `  ${c.symbol.padEnd(12)} OK  mc=${mapped.marketCapSol.toFixed(2).padStart(12)}  priceDrift=${drift}%`,
    );
  }

  const list = await fetchCoins({ limit: 3, sort: "market_cap" });
  console.log(`\nlist endpoint: ${list.length} coins, first=${list[0]?.symbol}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

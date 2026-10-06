/**
 * Fill the pair label on StonkFun coins ingested before the quote columns
 * existed.
 *
 * The ingest now writes these at insertion time and heals legacy rows on every
 * tick (see `backfillStonkQuotes` in lib/ingest.ts), so this script is only for
 * running the same pass on demand — right after a migration, or to repair a
 * window of coins without waiting for the keeper.
 *
 *   ./scripts/with-prod-env.sh npx tsx scripts/backfill-quote-assets.ts
 */
import { prisma } from "../lib/db";
import { backfillStonkQuotes } from "../lib/ingest";
import { fetchStonkLaunches } from "../lib/stonkfun";

async function main() {
  const before = await prisma.coin.count({ where: { provider: "STONKFUN", quoteSymbol: null } });
  console.log(`StonkFun coins missing a pair label: ${before}`);

  // Pass the live window so still-listed launches resolve exactly (base mint ->
  // quote mint) instead of by symbol inference.
  const launches = await fetchStonkLaunches().catch(() => []);
  const fixed = await backfillStonkQuotes(launches);
  console.log(`resolved: ${fixed}`);

  const rows = await prisma.coin.findMany({
    where: { provider: "STONKFUN" },
    select: { symbol: true, quoteSymbol: true, quoteName: true, quoteIconUrl: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) {
    console.log(
      `${r.symbol.padEnd(10)} -> ${(r.quoteName ?? "—").padEnd(22)} [${r.quoteSymbol ?? "—"}] ${r.quoteIconUrl ? "logo" : "no-logo"}`,
    );
  }
}

main().finally(() => prisma.$disconnect());

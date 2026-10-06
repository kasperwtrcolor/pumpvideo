/**
 * StonkFun ingest, on demand.
 *
 *   npx tsx scripts/stonkfun.ts [--limit 12] [--min-liq 500] [--show 15]
 *
 * Against production:
 *
 *   ./scripts/with-prod-env.sh npm run stonkfun
 *
 * WHAT THIS IS FOR
 *
 * The 5-minute keeper already polls StonkFun every tick (`--stonkfun 12` in
 * scripts/sync-cron.sh), so nothing here is needed to keep the catalogue fresh.
 * This script exists for the times you want the window read *now* and the answer
 * printed — after a migration, while debugging the dust gate, or when you want to
 * see the launches currently clearing the floor without waiting for a tick and
 * grepping the cron log.
 *
 * It is a thin wrapper over `ingestStonkfun` (lib/ingest.ts), the same function
 * the keeper calls, so a manual run and an automatic one cannot disagree about
 * what qualifies — the gate, the supply read and the pair resolution all live in
 * one place.
 *
 * The window is a fixed rolling list of the latest 100 launches (the API ignores
 * paging parameters) and it turns over in roughly 47 minutes, so a `--limit`
 * above the number that clears the floor adds nothing; it is a ceiling, not a
 * target. `--min-liq` is the dust gate: the median launch holds ~$22 of Jupiter
 * liquidity, so at the default $500 most of any given window is dropped on
 * purpose.
 */
import { prisma } from "../lib/db";
import { ingestStonkfun, backfillStonkQuotes, STONKFUN_MIN_LIQ_USD } from "../lib/ingest";
import { fetchStonkLaunches } from "../lib/stonkfun";

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const LIMIT = arg("limit", 12);
const MIN_LIQ = arg("min-liq", STONKFUN_MIN_LIQ_USD);
const SHOW = arg("show", 15);

async function main() {
  console.log(`stonkfun: reading the window (limit ${LIMIT}, floor $${MIN_LIQ})`);

  const r = await ingestStonkfun({ limit: LIMIT, minLiquidityUsd: MIN_LIQ });
  if (r.considered === 0) {
    console.log("  window unreadable — nothing changed (an empty window and an unreadable one must not look alike)");
    return;
  }

  console.log(
    `  window ${r.considered}, ${r.kept} cleared the floor, ` +
      `+${r.added} coins, +${r.clips} clips, ${r.skipped} skipped`,
  );

  // Coins already in the catalogue never re-enter through `ingestStonkfun` (it
  // only adds mints it has not seen), so a bare "+0 coins" is the normal result
  // on a window that has already been polled. The repair pass is what still has
  // work to do at that point, so report it separately rather than letting a
  // healthy tick read as a no-op.
  const fixed = await backfillStonkQuotes(await fetchStonkLaunches().catch(() => []));
  if (fixed > 0) console.log(`  backfilled pair labels on ${fixed} older coins`);

  const [total, missingPair] = await Promise.all([
    prisma.coin.count({ where: { provider: "STONKFUN" } }),
    prisma.coin.count({ where: { provider: "STONKFUN", quoteSymbol: null } }),
  ]);
  console.log(`  catalogue: ${total} StonkFun coins, ${missingPair} without a pair label`);

  const newest = await prisma.coin.findMany({
    where: { provider: "STONKFUN" },
    select: {
      symbol: true,
      quoteSymbol: true,
      quoteName: true,
      quoteIconUrl: true,
      priceSol: true,
      marketCapSol: true,
      launchedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: SHOW,
  });

  console.log(`\n  newest ${newest.length}:`);
  for (const c of newest) {
    const pair = c.quoteSymbol
      ? `${c.quoteName ?? c.quoteSymbol}${c.quoteIconUrl ? "" : " (no logo)"}`
      : "— no pair label";
    const when = (c.launchedAt ?? c.createdAt).toISOString().slice(11, 16);
    console.log(`    ${when}  $${c.symbol.padEnd(10)} paired with ${pair}`);
  }
}

main()
  .catch((e) => {
    console.error(`stonkfun: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

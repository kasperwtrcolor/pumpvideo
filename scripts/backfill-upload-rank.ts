/**
 * Re-score uploaded clips that were created before rankFor() was applied at
 * upload time. They sit at rank 0 and are therefore outside the feed pool.
 *
 * Idempotent: recomputes from each coin's current market cap and launch time, so
 * running it twice changes nothing.
 */
import { prisma } from "@/lib/db";
import { rankFor } from "@/lib/ingest";

(async () => {
  const clips = await prisma.clip.findMany({
    where: { source: "UPLOAD", rank: 0 },
    select: {
      id: true,
      coin: { select: { symbol: true, marketCapSol: true, launchedAt: true, complete: true } },
    },
  });
  console.log(`uploaded clips stuck at rank 0: ${clips.length}`);
  for (const c of clips) {
    const rank = rankFor({
      marketCapSol: c.coin.marketCapSol,
      launchedAt: c.coin.launchedAt,
      complete: c.coin.complete,
    });
    await prisma.clip.update({ where: { id: c.id }, data: { rank } });
    console.log(`  ${c.coin.symbol}: rank 0 -> ${rank}`);
  }
  const poolCutoff = await prisma.clip.count({ where: { ready: true, rank: { gt: 0 } } });
  console.log(`ready clips with rank > 0: ${poolCutoff}`);
  process.exit(0);
})();

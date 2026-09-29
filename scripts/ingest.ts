/**
 * Ingest live pump.fun coins + attach an art-only clip to each.
 *
 *   npx tsx scripts/ingest.ts [--top 60] [--new 40] [--no-clips]
 *
 * This is the "every clip is a coin" pipeline, minus the TikTok scraper:
 * instead of pulling viral videos and binding them to coins, we pull live coins
 * and mint a clip for each. Swapping in a real TikTok ingester means writing
 * Clip rows with a videoUrl — nothing else changes.
 *
 * A thin wrapper over lib/ingest.ts, which is also what the 5-minute keeper
 * cron calls. Keeping the logic in one place is what stops a backfill here and
 * an auto-ingest there from disagreeing about how a coin is scored or filtered.
 *
 * For the timed, filtered route (new launches only, with the market-cap and art
 * guards) see `ingestNewTokens` — this script is the broad manual sweep.
 */
import { prisma } from "../lib/db";
import { ingestList } from "../lib/ingest";

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const TOP = arg("top", 60);
const NEW = arg("new", 40);
const WITH_CLIPS = !process.argv.includes("--no-clips");

async function main() {
  console.log(`ingesting pump.fun: top=${TOP} new=${NEW} clips=${WITH_CLIPS}`);
  const a = await ingestList({ sort: "market_cap", limit: TOP, withClips: WITH_CLIPS });
  console.log(`  top by market cap : ${a.coins} coins, +${a.clips} clips`);
  const b = await ingestList({ sort: "created_timestamp", limit: NEW, withClips: WITH_CLIPS });
  console.log(`  newest            : ${b.coins} coins, +${b.clips} clips`);

  const [coins, clipsCount] = await Promise.all([prisma.coin.count(), prisma.clip.count()]);
  console.log(`db now holds ${coins} coins / ${clipsCount} clips`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

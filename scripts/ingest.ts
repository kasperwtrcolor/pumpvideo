/**
 * Ingest live pump.fun coins + attach a clip to each.
 *
 *   npx tsx scripts/ingest.ts [--top 60] [--new 40] [--no-clips]
 *
 * This is the "every clip is a coin" pipeline, minus the TikTok scraper:
 * instead of pulling viral videos and binding them to coins, we pull live coins
 * and mint a vertical clip for each. Swapping in a real TikTok ingester means
 * writing Clip rows with source="TIKTOK" and a videoUrl — nothing else changes.
 */
import { prisma } from "../lib/db";
import { fetchCoins, toCoinRecord, type PumpCoin } from "../lib/pumpfun";

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const TOP = arg("top", 60);
const NEW = arg("new", 40);
const WITH_CLIPS = !process.argv.includes("--no-clips");

/** Caption the clip like a scraped video caption would read. */
function captionFor(c: PumpCoin) {
  const d = (c.description || "").trim().replace(/\s+/g, " ");
  const base = d && d.toLowerCase() !== c.name.toLowerCase() ? d : c.name;
  return base.slice(0, 90);
}

function rankFor(coin: { marketCapSol: number; launchedAt: Date | null; complete: boolean }) {
  const ageH = coin.launchedAt
    ? Math.max(0.5, (Date.now() - coin.launchedAt.getTime()) / 3_600_000)
    : 72;
  // Reward fresh + alive-on-the-curve, dampen giants so the feed isn't just majors.
  const freshness = 24 / (ageH + 6);
  const size = Math.log10(Math.max(1, coin.marketCapSol) + 1);
  const curveBoost = coin.complete ? 0.4 : 1.3;
  return Number(((freshness * 2 + size) * curveBoost).toFixed(4));
}

async function ingest(
  sort: "market_cap" | "created_timestamp",
  limit: number,
  offset = 0,
) {
  const coins = await fetchCoins({ sort, order: "DESC", limit, offset });
  let upserted = 0;
  let clips = 0;

  for (const c of coins) {
    if (!c.mint || !c.name || !c.symbol) continue;
    if (c.is_banned) continue;

    const record = toCoinRecord(c);
    const rank = rankFor({
      marketCapSol: record.marketCapSol,
      launchedAt: record.launchedAt,
      complete: record.complete,
    });

    const coin = await prisma.coin.upsert({
      where: { mint: record.mint },
      create: {
        ...record,
        change24hPct: 0,
        holders: 0,
        isBanned: Boolean(c.is_banned),
      },
      update: { ...record, isBanned: Boolean(c.is_banned) },
    });
    upserted++;

    if (WITH_CLIPS) {
      const existing = await prisma.clip.findFirst({
        where: { coinId: coin.id },
        select: { id: true },
      });
      const caption = captionFor(c);
      if (!existing) {
        await prisma.clip.create({
          data: {
            coinId: coin.id,
            source: "SEED",
            // Generated from the coin art by scripts/gen-clips.ts.
            // A TikTok ingester would drop an HLS URL in here instead.
            videoUrl: `/clips/${coin.mint}.mp4`,
            thumbUrl: `/thumbs/${coin.mint}.jpg`,
            caption,
            author: "unclaimed",
            likes: Math.round(Math.log10(Math.max(10, record.marketCapSol)) * 40),
            shares: Math.round(Math.log10(Math.max(10, record.marketCapSol)) * 6),
            comments: Math.round(Math.log10(Math.max(10, record.marketCapSol)) * 3),
            views: Math.round(Math.log10(Math.max(10, record.marketCapSol)) * 900),
            rank,
          },
        });
        clips++;
      } else {
        await prisma.clip.updateMany({
          where: { coinId: coin.id },
          data: { rank },
        });
      }
    }
  }
  return { upserted, clips };
}

async function main() {
  console.log(`ingesting pump.fun: top=${TOP} new=${NEW} clips=${WITH_CLIPS}`);
  const a = await ingest("market_cap", TOP, 0);
  console.log(`  top by market cap : +${a.upserted} coins, +${a.clips} clips`);
  const b = await ingest("created_timestamp", NEW, 0);
  console.log(`  newest            : +${b.upserted} coins, +${b.clips} clips`);

  const [coins, clipsCount] = await Promise.all([
    prisma.coin.count(),
    prisma.clip.count(),
  ]);
  console.log(`db now holds ${coins} coins / ${clipsCount} clips`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

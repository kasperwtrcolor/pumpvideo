/**
 * Token ingestion — getting new coins into the catalog.
 *
 * ONE implementation, shared by:
 *   - scripts/ingest.ts  (the manual/backfill CLI)
 *   - lib/keeper.ts      (the 5-minute VPS cron, via scripts/sync.ts)
 *
 * Where this sits in the product: the catalog is not curated. Coins come from
 * pump.fun's own rankings, and this pipeline is what stops the app being a
 * frozen snapshot of whatever was popular the day it was seeded. Two routes in:
 *
 *   ingestList       — a page of the ranked list, used for the initial fill and
 *                      for deliberate backfills. Broad.
 *   ingestNewTokens  — the newest launches, filtered, used every few minutes by
 *                      the keeper. Narrow, and guarded hard (see below).
 *
 * A note on why a clip is created *without* a video:
 *   The feed is clip-shaped, so a new coin needs a clip row to appear at all.
 *   Rendering a video for it is a separate, expensive stage (ffmpeg, then the
 *   file has to reach the CDN). So a freshly ingested token gets an art-only
 *   clip: `videoUrl: null`, the coin art as its thumbnail, and the feed shows
 *   that drifting gently with a "new token" label. `scripts/gen-clips.ts`
 *   renders a real video later and upgrades the row. That decoupling is what
 *   makes ingestion cheap enough to run on a timer.
 */
import { prisma } from "./db";
import { fetchCoins, toCoinRecord, type PumpCoin } from "./pumpfun";
import { artUrl } from "./art-url";

/**
 * Guards for auto-ingested tokens. This is the difference between a discovery
 * feed and a sewer: pump.fun launches thousands of coins a day and most are
 * launched to be abandoned within minutes.
 *
 *   MIN_MCAP_SOL  — below this a coin has essentially no buyers. It also filters
 *                   the instant-rug pattern where liquidity is pulled at a
 *                   market cap of a few SOL.
 *   MAX_AGE_HOURS — the "new" ranking page is ordered by creation time, so its
 *                   tail is old; this stops a slow tick re-adding ancient coins.
 *   art required  — a token with no image is a blank card in the feed. Better to
 *                   skip it than to ship a black rectangle with a buy button.
 */
export const MIN_MCAP_SOL = 30;
const MAX_AGE_HOURS = 72;

/** Ranking score, shared so the CLI and the cron can never order the feed differently. */
export function rankFor(coin: {
  marketCapSol: number;
  launchedAt: Date | null;
  complete: boolean;
}) {
  const ageH = coin.launchedAt
    ? Math.max(0.5, (Date.now() - coin.launchedAt.getTime()) / 3_600_000)
    : 72;
  // Reward fresh + alive-on-the-curve, dampen giants so the feed isn't just majors.
  const freshness = 24 / (ageH + 6);
  const size = Math.log10(Math.max(1, coin.marketCapSol) + 1);
  const curveBoost = coin.complete ? 0.4 : 1.3;
  return Number(((freshness * 2 + size) * curveBoost).toFixed(4));
}

/** Caption the clip like a scraped video caption would read. */
export function captionFor(c: PumpCoin) {
  const d = (c.description || "").trim().replace(/\s+/g, " ");
  const base = d && d.toLowerCase() !== c.name.toLowerCase() ? d : c.name;
  return base.slice(0, 90);
}

/**
 * Upsert one coin and, if it has no clip yet, give it an art-only one.
 *
 * Returns whether a clip was created. Shared by both ingestion routes so a coin
 * picked up by the cron and one picked up by a backfill are indistinguishable
 * afterwards.
 */
export async function upsertCoinWithClip(c: PumpCoin): Promise<{ created: boolean }> {
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

  const existing = await prisma.clip.findFirst({
    where: { coinId: coin.id },
    select: { id: true },
  });

  if (existing) {
    // Keep the ordering score current; never touch an existing clip's assets.
    await prisma.clip.update({ where: { id: existing.id }, data: { rank } });
    return { created: false };
  }

  await prisma.clip.create({
    data: {
      coinId: coin.id,
      source: "INGEST",
      // No video yet — see the module comment. `ready` means "fit to serve",
      // and an art-only card is fit to serve; it is not waiting on anything.
      videoUrl: null,
      thumbUrl: artUrl(coin.imageUrl),
      caption: captionFor(c),
      author: "unclaimed",
      // Engagement counters start at zero and are only ever moved by real
      // ClipLike / ClipComment / ClipShare rows. Inventing a plausible number
      // from market cap made the feed look alive while telling a lie about
      // every clip.
      rank,
      ready: true,
    },
  });

  return { created: true };
}

/** Broad ingest: one page of the ranked list. Used for the initial fill/backfill. */
export async function ingestList(opts: {
  sort: "market_cap" | "created_timestamp";
  limit: number;
  offset?: number;
  withClips?: boolean;
}): Promise<{ coins: number; clips: number }> {
  const { sort, limit, offset = 0, withClips = true } = opts;
  const coins = await fetchCoins({ sort, order: "DESC", limit, offset });

  let upserted = 0;
  let clips = 0;

  for (const c of coins) {
    if (!c.mint || !c.name || !c.symbol) continue;
    if (c.is_banned) continue;
    upserted++;
    if (!withClips) continue;
    const { created } = await upsertCoinWithClip(c);
    if (created) clips++;
  }

  return { coins: upserted, clips };
}

/**
 * Narrow ingest: the newest launches that pass the guards.
 *
 * `limit` is how many coins to *consider*, not how many land — most of a fresh
 * page is filtered out, which is the intended behaviour. Returns both counts so
 * a cron log shows the ratio rather than quietly doing nothing.
 *
 * WHY THERE IS NO MINIMUM-AGE GATE HERE
 *
 * Requiring a launch to have survived half an hour is the obvious way to filter
 * rugs, and it was implemented and then removed: pump.fun publishes roughly 45
 * coins a minute, so the newest 50 launches span about *one* minute and every
 * row on the page fails the gate. Reaching a 30-minute boundary means paging
 * ~1,350 rows per tick, which would consume the rate-limit budget the price
 * sweep shares in the same tick. The gate did not filter the page, it emptied
 * it — ingest landed 0 coins on every run.
 *
 * So filtering happens where it is cheap and where the evidence exists: at the
 * ingest floor for market cap, and by measurement afterwards in lib/retention.ts,
 * which is the only place that can actually tell a dead coin from a live one.
 */
export async function ingestNewTokens(opts: { limit: number }): Promise<{
  considered: number;
  coins: number;
  clips: number;
  skipped: number;
}> {
  const candidates = await fetchCoins({
    sort: "created_timestamp",
    order: "DESC",
    limit: opts.limit,
  });

  const oldestAllowed = Date.now() - MAX_AGE_HOURS * 3_600_000;

  // Tokens the retention sweep has already pruned. Without this the sweep and
  // the ingest fight: every tick would re-fetch and re-update a coin the app has
  // deliberately dropped, which costs a write and — because the upsert does not
  // touch `hiddenAt` — would leave a row that looks present in the table but is
  // absent from every screen. Skipping is both cheaper and clearer.
  const hiddenMints = new Set(
    (
      await prisma.coin.findMany({
        where: { mint: { in: candidates.map((c) => c.mint) }, hiddenAt: { not: null } },
        select: { mint: true },
      })
    ).map((r) => r.mint),
  );

  let coins = 0;
  let clips = 0;
  let skipped = 0;

  for (const c of candidates) {
    if (!c.mint || !c.name || !c.symbol) {
      skipped++;
      continue;
    }
    if (hiddenMints.has(c.mint)) {
      skipped++;
      continue;
    }
    if (c.is_banned || c.nsfw) {
      skipped++;
      continue;
    }
    // No art means a black card with a buy button in the feed.
    if (!c.image_uri) {
      skipped++;
      continue;
    }
    const record = toCoinRecord(c);
    if (record.marketCapSol < MIN_MCAP_SOL) {
      skipped++;
      continue;
    }
    // Older than the discovery window. The point of this path is new launches,
    // so anything past MAX_AGE_HOURS belongs to the backfill, not here.
    if (record.launchedAt && record.launchedAt.getTime() < oldestAllowed) {
      skipped++;
      continue;
    }

    try {
      const { created } = await upsertCoinWithClip(c);
      coins++;
      if (created) clips++;
    } catch (e) {
      // One bad coin must not abandon the rest of the tick.
      skipped++;
      console.warn(`ingest: $${c.symbol} failed: ${describeError(e)}`);
    }
  }

  return { considered: candidates.length, coins, clips, skipped };
}

/**
 * One line describing a thrown value.
 *
 * `(e as Error).message` is not enough: a network failure to the database
 * arrives as an `AggregateError`, whose `message` is *empty* — the real cause
 * lives in `.errors[]`. Logging just the message produced
 * `ingest: $EXIT failed: ` with nothing after it, which is undiagnosable: it
 * looks identical whether the cause was a timeout, a DNS failure, or a bug.
 */
function describeError(e: unknown): string {
  if (e instanceof AggregateError) {
    const inner = e.errors.map((x) => describeError(x)).join("; ");
    return `${e.name}${e.message ? `: ${e.message}` : ""}${inner ? ` [${inner}]` : ""}`;
  }
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    return `${e.name}${code ? `(${code})` : ""}: ${e.message || "(no message)"}`;
  }
  return String(e);
}

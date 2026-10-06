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
import { fetchTrending } from "./dexscreener";
import { fetchJupPrices } from "./jup-price";
import {
  fetchStonkLaunches,
  fetchTokenSupplyRaw,
  resolveQuoteAssets,
  resolveQuoteAssetsBySymbol,
  type QuoteAsset,
  type StonkLaunch,
} from "./stonkfun";
import { solUsd } from "./sol-price";
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
export function describeError(e: unknown): string {
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

/**
 * Trending ingest — the Dexscreener board, filtered to tokens that are actually
 * trading (see `fetchTrending` in lib/dexscreener.ts for why the boost board is
 * the only public proxy for "trending" and the volume/liquidity floors are what
 * make it mean "trending" rather than "paid").
 *
 * Where this sits in the product: this is the one ingest path that is NOT
 * pump.fun. A token trending on Dexscreener may never have been launched on
 * pump.fun, and the whole point of the Trending rail is to show what the market
 * is trading — not what our original source happened to carry. So a survivor is
 * upserted in the same shape as any other coin (`provider: "DEXSCREENER"`) and
 * gets the same art-only placeholder clip, which a real upload supersedes
 * exactly as it does for an ingested launch (that is why the clip's `source` is
 * `INGEST`, not a trending-specific value).
 *
 * Membership is the `trendingAt` stamp: every survivor is stamped "now", and
 * any coin NOT on this tick's board has its stamp cleared. The rail reads the
 * stamp, so a token that leaves the board leaves the rail on the very next tick
 * rather than lingering until its volume ages out.
 *
 * Transient-cost note: the boosts fan out to a handful of Dexscreener calls
 * (~31 mints today = two pairs calls). On any failure `fetchTrending` returns
 * an empty list, and this function then changes NOTHING — an unread board must
 * not read as "the board is empty" and blank the rail.
 */
export async function ingestTrending(opts: {
  limit: number;
  minVolumeUsd?: number;
  minLiquidityUsd?: number;
}): Promise<{
  considered: number;
  kept: number;
  added: number;
  clips: number;
  dropped: number;
}> {
  const trending = await fetchTrending({
    minVolumeUsd: opts.minVolumeUsd,
    minLiquidityUsd: opts.minLiquidityUsd,
  });

  // An empty board is "we could not read it", never "nothing is trending".
  // Returning early leaves the previous board (and the rail) intact.
  if (trending.length === 0) {
    return { considered: 0, kept: 0, added: 0, clips: 0, dropped: 0 };
  }

  const board = trending.slice(0, opts.limit);
  const usd = await solUsd().catch(() => 0);
  const now = new Date();
  const mints = board.map((t) => t.mint);

  let added = 0;
  let clips = 0;

  for (const t of board) {
    const existing = await prisma.coin.findUnique({
      where: { mint: t.mint },
      select: { id: true },
    });

    const record = {
      provider: "DEXSCREENER",
      name: t.name,
      symbol: t.symbol,
      imageUrl: t.imageUrl,
      priceSol: t.priceSol,
      // Market cap and volume are stored in SOL, like every other coin, so the
      // Trending rail can rank a foreign token against a pump.fun one on one
      // scale. Without a SOL price we cannot convert — write 0 rather than a
      // USD figure that would dwarf every SOL-denominated coin on the rail.
      marketCapSol: usd > 0 ? t.marketCapUsd / usd : 0,
      volume24hSol: usd > 0 ? t.volume24hUsd / usd : 0,
      change24hPct: t.change24hPct,
      poolAddress: t.poolAddress,
      // A Dexscreener pair exists only for a token that has left a bonding
      // curve for a real pool, so it is graduated by definition.
      complete: true,
      trendingAt: now,
      lastSyncedAt: now,
      ...(t.launchedAt ? { launchedAt: t.launchedAt } : {}),
    };

    const coin = await prisma.coin.upsert({
      where: { mint: t.mint },
      create: { mint: t.mint, ...record },
      update: record,
    });
    if (!existing) added++;

    const thumb = artUrl(coin.imageUrl);
    const existingClip = await prisma.clip.findFirst({
      where: { coinId: coin.id },
      select: { id: true, source: true, videoUrl: true, thumbUrl: true },
    });
    if (!existingClip) {
      await prisma.clip.create({
        data: {
          coinId: coin.id,
          // INGEST, not a trending-specific source: this is the same art-only
          // placeholder an ingested launch gets. A null-video placeholder is not
          // a real clip — a real upload supersedes it (the clips route deletes
          // any clip with `videoUrl: null` for the coin), and the feed hides one
          // whenever its coin has a real clip, so user videos take precedence.
          source: "INGEST",
          videoUrl: null,
          thumbUrl: thumb,
          caption: (t.name || t.symbol).slice(0, 90),
          author: "unclaimed",
          rank: rankFor({
            marketCapSol: record.marketCapSol,
            launchedAt: t.launchedAt,
            complete: true,
          }),
          ready: true,
        },
      });
      clips++;
    } else if (existingClip.source === "INGEST" && existingClip.videoUrl === null) {
      // A placeholder art card, not a real clip — keep its art aligned with the
      // coin's current logo. Without this, a card created before the image
      // source was corrected to the token's own logo would keep showing the old
      // promotional banner forever (the create branch never runs again). A real
      // uploaded clip is left untouched.
      if (existingClip.thumbUrl !== thumb) {
        await prisma.clip.update({ where: { id: existingClip.id }, data: { thumbUrl: thumb } });
      }
    }
  }

  // Everything the board no longer names loses its stamp — a token is trending
  // because *this* board says so, not because it said so once.
  const dropped = await prisma.coin.updateMany({
    where: { trendingAt: { not: null }, mint: { notIn: mints } },
    data: { trendingAt: null },
  });

  return {
    considered: trending.length,
    kept: board.length,
    added,
    clips,
    dropped: dropped.count,
  };
}

/**
 * Dust floor for StonkFun ingestion, in USD of Jupiter liquidity.
 *
 * Why a floor at all: `GET /api/launches` is a rolling window of the *latest
 * 100* launches and StonkFun produces roughly 127 an hour, so taking it
 * wholesale would pour ~3,000 coins a day into the feed. Worse, most of them are
 * shells — measured on 2026-10-06, the median launch held **$22** of liquidity,
 * the 75th percentile $61, and only 10 of 100 cleared $500. Pemp's own ingest
 * floor (MIN_MCAP_SOL) cannot catch this: StonkFun coins start around $3,385
 * (~28 SOL), right on the boundary.
 *
 * Liquidity, not market cap, is the honest gate here. A launch market cap is
 * whatever the dev types in, and the API only publishes the value from launch
 * time — but liquidity is what someone else has actually deposited, and it is
 * the only number that says a stranger is willing to trade against a coin.
 *
 * $500 keeps the ~10% with a real seed behind them. That window rolls every ~47
 * minutes, so a coin that starts tiny and gains traction inside the window is
 * still picked up on a later poll — which is the behaviour we want, rather than
 * ingesting the shell at minute zero.
 */
export const STONKFUN_MIN_LIQ_USD = 500;

/**
 * StonkFun ingest — a third launch source, after pump.fun and Dexscreener.
 *
 * The pipeline is deliberately identical to the other two so a StonkFun coin is
 * indistinguishable from any other once it is in: same `Coin` shape, same
 * art-only placeholder clip, same ranking score. The differences are three, and
 * all of them follow from the source:
 *
 *   1. Discovery is their rolling `/api/launches` window (see lib/stonkfun.ts).
 *   2. The dust gate is Jupiter liquidity, because these coins have no SOL pair
 *      and so no Dexscreener volume to gate on (see STONKFUN_MIN_LIQ_USD).
 *   3. Supply is read on-chain (`getTokenSupply`), because the API publishes no
 *      supply and every derived market cap depends on it.
 *
 * Pricing is NOT done here. A newly inserted coin is part of the catalog the
 * keeper reads on the same tick, and the Jupiter fallback pass prices it then —
 * one pricing path, not two.
 *
 * An empty or unreadable window changes nothing (same rule as `ingestTrending`):
 * "we could not read it" must never be written down as "there is nothing there".
 */
export async function ingestStonkfun(opts: {
  limit: number;
  minLiquidityUsd?: number;
}): Promise<{
  considered: number;
  kept: number;
  added: number;
  clips: number;
  skipped: number;
}> {
  const launches = await fetchStonkLaunches();
  if (launches.length === 0) {
    return { considered: 0, kept: 0, added: 0, clips: 0, skipped: 0 };
  }

  const usd = await solUsd().catch(() => 0);

  // Only mints we do not already have, in one query for the whole window.
  const known = new Set(
    (
      await prisma.coin.findMany({
        where: { mint: { in: launches.map((l) => l.mint) } },
        select: { mint: true },
      })
    ).map((c) => c.mint),
  );
  const fresh = launches.filter((l) => !known.has(l.mint));

  // One Jupiter call prices the whole candidate set, and doubles as the gate.
  const jup = await fetchJupPrices(fresh.map((l) => l.mint)).catch(() => new Map());
  const floor = opts.minLiquidityUsd ?? STONKFUN_MIN_LIQ_USD;
  const qualified = fresh
    .filter((l) => (jup.get(l.mint)?.liquidityUsd ?? 0) >= floor)
    .slice(0, opts.limit);

  // The pair label. One bulk lookup for every quote mint this window uses — the
  // window shares a handful of counterparties (mostly NVDAX), so this is a single
  // call for the whole tick. Best-effort: a coin whose counterparty Jupiter does
  // not list still lands, just with its symbol-only label.
  const quotes = await resolveQuoteAssets(
    qualified.map((l) => l.quoteMint).filter((m): m is string => Boolean(m)),
  ).catch(() => new Map());

  let added = 0;
  let clips = 0;
  let skipped = 0;

  for (const l of qualified) {
    const supply = await fetchTokenSupplyRaw(l.mint);
    const quote = jup.get(l.mint);
    if (!supply || !quote || usd <= 0) {
      skipped++;
      continue;
    }

    const priceSol = quote.usdPrice / usd;
    const marketCapSol = priceSol * (Number(supply) / 1e6);
    const launchedAt = l.createdAt;
    const asset = l.quoteMint ? quotes.get(l.quoteMint) : undefined;

    const record = {
      provider: "STONKFUN",
      name: l.name,
      symbol: l.symbol,
      description: l.quoteSymbol ? `paired with ${l.quoteSymbol}` : null,
      imageUrl: l.logoUrl,
      totalSupply: supply,
      priceSol,
      marketCapSol,
      change24hPct: quote.change24hPct ?? 0,
      poolAddress: l.pool,
      creator: l.creator,
      // What the coin is quoted against. The launchpad's own ticker is the
      // fallback; Jupiter's is preferred because it is the canonical casing that
      // matches the logo it returned.
      quoteMint: l.quoteMint,
      quoteSymbol: asset?.symbol ?? l.quoteSymbol,
      quoteName: asset?.name ?? null,
      quoteIconUrl: asset?.iconUrl ?? null,
      // Still on the launchpad's own curve, not a graduated AMM: Dexscreener
      // indexes no pair for them at all (measured: 0 pairs), which is the same
      // signal pump.fun gives with `complete: false`. So the dust gate and the
      // curve ranking treat them like any other fresh launch.
      complete: false,
      lastSyncedAt: new Date(),
      ...(launchedAt ? { launchedAt } : {}),
    };

    const coin = await prisma.coin.upsert({
      where: { mint: l.mint },
      create: { mint: l.mint, ...record },
      update: record,
    });
    added++;

    const thumb = artUrl(coin.imageUrl);
    const existingClip = await prisma.clip.findFirst({
      where: { coinId: coin.id },
      select: { id: true },
    });
    if (!existingClip) {
      await prisma.clip.create({
        data: {
          coinId: coin.id,
          source: "INGEST",
          videoUrl: null,
          thumbUrl: thumb,
          caption: (l.name || l.symbol).slice(0, 90),
          author: "unclaimed",
          rank: rankFor({ marketCapSol, launchedAt, complete: false }),
          ready: true,
        },
      });
      clips++;
    }
  }

  // Pair labels for coins ingested before these columns existed. Self-healing
  // rather than a one-off script: it runs inside the same opt-in step, converges
  // in a tick or two, and afterwards costs one indexed query and no network.
  await backfillStonkQuotes(launches).catch(() => 0);

  return { considered: launches.length, kept: qualified.length, added, clips, skipped };
}

/**
 * Fill the pair label on StonkFun coins ingested before the quote columns
 * existed.
 *
 * Two routes, in order of trust:
 *
 *   1. The launch is still in the rolling window (`launches`), so the pair comes
 *      straight from the launchpad — base mint to quote mint, no inference.
 *   2. The launch has aged out of the window, and the only surviving record of
 *      the pair is the symbol the ingest wrote into `description` ("paired with
 *      NVDAX"). Symbols collide, so the symbol route ranks candidates by
 *      liquidity (see resolveQuoteAssetsBySymbol) and is the reason the resolved
 *      mint is written back: after one pass the coin carries `quoteMint` and the
 *      fallback is never needed again.
 *
 * A row stays uncorrected when neither route resolves — the counterparty is not
 * in Jupiter's list — and is retried on the next tick. It keeps the symbol-only
 * label meanwhile.
 */
export async function backfillStonkQuotes(launches?: StonkLaunch[]): Promise<number> {
  const rows = await prisma.coin.findMany({
    where: { provider: "STONKFUN", quoteSymbol: null },
    select: { id: true, mint: true, description: true },
    take: 200,
  });
  if (rows.length === 0) return 0;

  // Route 1 — exact, from the launchpad itself.
  const window = new Map<string, StonkLaunch>();
  for (const l of launches ?? []) window.set(l.mint, l);
  const windowed = rows.filter((r) => window.get(r.mint)?.quoteMint);
  const byMint = windowed.length
    ? await resolveQuoteAssets(
        windowed.map((r) => window.get(r.mint)!.quoteMint as string),
      ).catch(() => new Map<string, QuoteAsset>())
    : new Map<string, QuoteAsset>();

  // Route 2 — symbol inference, for the rows the window no longer covers.
  const symbols = rows
    .filter((r) => !window.get(r.mint)?.quoteMint)
    .map((r) => pairSymbol(r.description))
    .filter((s): s is string => Boolean(s));
  const bySymbol = symbols.length
    ? await resolveQuoteAssetsBySymbol(symbols).catch(() => new Map<string, QuoteAsset>())
    : new Map<string, QuoteAsset>();

  let fixed = 0;
  for (const r of rows) {
    const launch = window.get(r.mint);
    let data: {
      quoteMint: string | null;
      quoteSymbol: string | null;
      quoteName: string | null;
      quoteIconUrl: string | null;
    } | null = null;

    if (launch?.quoteMint) {
      const a = byMint.get(launch.quoteMint);
      data = {
        quoteMint: launch.quoteMint,
        quoteSymbol: a?.symbol ?? launch.quoteSymbol ?? launch.quoteMint.slice(0, 6),
        quoteName: a?.name ?? null,
        quoteIconUrl: a?.iconUrl ?? null,
      };
    } else {
      const sym = pairSymbol(r.description);
      const a = sym ? bySymbol.get(sym.toUpperCase()) : undefined;
      if (a) {
        data = {
          quoteMint: a.mint,
          quoteSymbol: a.symbol,
          quoteName: a.name,
          quoteIconUrl: a.iconUrl,
        };
      }
    }

    if (!data) continue;
    await prisma.coin.update({ where: { id: r.id }, data });
    fixed++;
  }
  return fixed;
}

/** "paired with NVDAX" -> "NVDAX". The ingest's own caption is the only trace. */
function pairSymbol(description: string | null): string | null {
  const s = description?.replace(/^paired with\s+/i, "").trim();
  return s || null;
}

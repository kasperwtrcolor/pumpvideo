import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin, serializeClip, positionLite } from "@/lib/api";
import { readTrader, resolveTrader } from "@/lib/session";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { solUsd } from "@/lib/sol-price";
import { seededShuffle } from "@/lib/shuffle";

export const dynamic = "force-dynamic";

type Sort = "hot" | "new" | "top";

/**
 * How many clips the shuffle draws from when a `seed` is supplied.
 *
 * Shuffling has to be a permutation of a *fixed* list for offset pagination to
 * stay coherent (see lib/shuffle.ts), so we take the top N by the chosen sort
 * and permute those. N is the working set the feed actually walks through in a
 * session; beyond it the ranking is a long tail nobody scrolls to. Growing the
 * catalog past this just changes which clips are poolable, never the paging.
 *
 * The sort still means something under a shuffle: it chooses the *pool* ("top"
 * shuffles the biggest, "new" shuffles the freshest) and the seed only decides
 * the order within it. Shuffling the entire catalog instead would make the sort
 * rail decorative.
 */
const POOL = 300;

/**
 * How many coins the Hot wall draws from.
 *
 * Hot is "the movers", and a fixed percentage floor is the wrong instrument for
 * that: market caps span six orders of magnitude, so a floor that catches a
 * micro-cap's wiggle is blind to a liquid major's, and a floor tight enough for
 * the majors empties the wall. Ranking by volatility and taking the top N is
 * self-scaling — it always yields a full wall of the genuinely most-moved coins,
 * whatever the day's market is doing — and it keeps Hot distinct from the
 * catalog, which a floor that most coins clear would not (under a shuffle the
 * sort only picks the pool; a pool of everything makes the rail decorative).
 */
const HOT_POOL = 40;

/** "Top" means a market cap of at least this many USD. */
const TOP_MIN_USD = 100_000;

/**
 * GET /api/feed?sort=hot|new|top&limit=12&offset=0&seed=<str>&mint=<optional>
 *
 * Returns clips stitched to their coin. This is the single payload the vertical
 * swiper renders per page — video URL, caption, coin market state, trader balance.
 *
 * `seed` turns the feed into a randomised-but-stable order. Omit it and the feed
 * is plain ranked; supply it and the same seed always yields the same sequence,
 * which is what lets the client page through a shuffled feed without repeats.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sort = (sp.get("sort") as Sort) || "hot";
  const limit = Math.min(24, Math.max(1, Number(sp.get("limit")) || 12));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const mint = sp.get("mint");
  const seed = sp.get("seed")?.slice(0, 64) ?? "";

  // Pool cutoff for the shuffled feed. The seed fixes the *order*; this fixes the
  // *contents*, so a clip ingested while the visitor is scrolling can't re-permute
  // the wall out from under them (which would repeat clips across pages).
  // Clamped to now, and ignored unless it's a plausible epoch-ms value.
  const sinceRaw = Number(sp.get("since"));
  const since =
    Number.isFinite(sinceRaw) && sinceRaw > 1_000_000_000_000
      ? new Date(Math.min(sinceRaw, Date.now()))
      : null;

  // Every ordering carries `id` as a final tiebreaker. Without it two clips with
  // the same rank/timestamp could come back in either order on different
  // requests, and the shuffled permutation would shift between pages — dropping
  // some clips and repeating others.
  //
  // Hot and Top rank by a property of the *coin*, not the clip: Hot lifts the
  // coins that moved most over the last five minutes (in either direction), Top
  // the coins above the market-cap floor. `rank` is the tiebreaker so a wall of
  // equally-volatile coins still has a stable order to permute.
  const orderBy =
    sort === "new"
      ? [{ createdAt: "desc" as const }, { id: "asc" as const }]
      : sort === "top"
        ? [{ coin: { marketCapSol: "desc" as const } }, { rank: "desc" as const }, { id: "asc" as const }]
        : sort === "hot"
          ? [{ coin: { volatility5m: "desc" as const } }, { rank: "desc" as const }, { id: "asc" as const }]
          : [{ rank: "desc" as const }, { id: "asc" as const }];

  // SOL/USD is needed up here because the Top floor is a USD figure and market
  // caps are stored in SOL. Cached for 60s inside solUsd(), so this costs
  // nothing even though the ticker route calls it too.
  const usd = await solUsd();

  /**
   * `scope=following` narrows the wall to the viewer's social graph: clips by
   * people they follow, plus clips on coins they follow — whoever uploaded them.
   *
   * The coin half is the one that makes this interesting. A coin's clips come
   * from many creators, so following a token is how you see all of them without
   * having to follow each creator individually.
   *
   * A viewer who follows nobody gets an empty wall rather than the global feed.
   * Falling back would be friendlier-looking and completely wrong: the screen
   * claims to be your following feed, and showing strangers' clips there would
   * make the toggle a lie.
   *
   * Read from the cookie without creating a row — an anonymous visitor must not
   * be able to trigger a write (and a rate-limited follow-up) by scrolling.
   */
  let social: Record<string, unknown> = {};
  if (sp.get("scope") === "following") {
    const viewer = await readTrader();
    let follows: { followingId: string }[] = [];
    let tokenFollows: { coinId: string }[] = [];
    if (viewer) {
      [follows, tokenFollows] = await Promise.all([
        prisma.follow.findMany({
          where: { followerId: viewer.id },
          select: { followingId: true },
        }),
        prisma.tokenFollow.findMany({
          where: { traderId: viewer.id },
          select: { coinId: true },
        }),
      ]);
    }
    social = {
      OR: [
        { uploadedById: { in: follows.map((f) => f.followingId) } },
        { coinId: { in: tokenFollows.map((f) => f.coinId) } },
      ],
    };
  }

  /**
   * The where-clause, as a function of whether the Hot/Top gate is applied.
   *
   * Building it twice is what lets the gates fall back: on a catalog the keeper
   * has not measured yet (a fresh deploy, or movement this quiet), every coin
   * would fail the volatility floor and Hot would render an empty wall. Rather
   * than a blank screen, the gate is dropped and the ranked feed shows — the
   * rail still says Hot, but with nothing volatile to rank we show the catalog
   * instead of nothing. Still honest: every clip served is a real clip.
   */
  const buildWhere = (gate: boolean) => {
    const coin: Prisma.CoinWhereInput = mint ? { mint } : { isBanned: false };
    if (gate && !mint) {
      // Hot excludes coins the keeper has not measured any movement on (0). A
      // coin with a real, positive score — however small — is a coin that moved.
      if (sort === "hot") coin.volatility5m = { gt: 0 };
      if (sort === "top") coin.marketCapSol = { gte: TOP_MIN_USD / usd };
    }
    return {
      ready: true,
      coin,
      ...(since ? { createdAt: { lte: since } } : {}),
      ...social,
    };
  };

  let where = buildWhere(true);
  let total = await prisma.clip.count({ where });
  if (total === 0 && !mint) {
    where = buildWhere(false);
    total = await prisma.clip.count({ where });
  }

  let clips: Awaited<ReturnType<typeof loadClips>>;

  if (seed) {
    // Two steps on purpose. Permuting the pool *ids* and then loading only the
    // requested window keeps this bounded by `limit` rows of real work: the
    // obvious version (fetch the whole pool with its coin and slice in memory)
    // pulls every pool row's relations on every page request, which is both
    // slow and pointless — 12 rows are ever rendered.
    const pool = await prisma.clip.findMany({
      where,
      orderBy,
      // Hot permutes only its top movers, so the wall is volatile even after the
      // shuffle; every other rail permutes the whole working set.
      take: sort === "hot" ? Math.min(HOT_POOL, total) : Math.min(POOL, total),
      select: { id: true },
    });
    const page = seededShuffle(pool, seed).slice(offset, offset + limit);
    clips = await loadClips(page.map((p) => p.id));
  } else {
    clips = await prisma.clip.findMany({
      where,
      include: { coin: true },
      orderBy,
      take: limit,
      skip: offset,
    });
  }

  // Who is asking? Resolved once, here, and threaded through withTrader — calling
  // it twice inside one request would mint two trader rows and point the cookie
  // at the wrong one.
  const { trader, created } = await resolveTrader();

  const ids = clips.map((c) => c.id);
  const coinIds = clips.map((c) => c.coinId);

  const [likedIds, favoriteIds, positionRows] = trader
    ? await Promise.all([
        prisma.clipLike
          .findMany({
            where: { traderId: trader.id, clipId: { in: ids } },
            select: { clipId: true },
          })
          .then((rows) => new Set(rows.map((r) => r.clipId))),
        prisma.clipFavorite
          .findMany({
            where: { traderId: trader.id, clipId: { in: ids } },
            select: { clipId: true },
          })
          .then((rows) => new Set(rows.map((r) => r.clipId))),
        // The caller's holdings across this window, so each clip can be coloured
        // against their own entry price. One query for the page, not one per clip.
        prisma.position.findMany({
          where: { traderId: trader.id, coinId: { in: coinIds } },
          select: { coinId: true, tokenAmount: true, costSol: true },
        }),
      ])
    : [new Set<string>(), new Set<string>(), []];

  const positionByCoin = new Map(positionRows.map((p) => [p.coinId, p]));

  return withTrader(
    {
      items: clips.map((c) => {
        const pos = positionByCoin.get(c.coinId);
        return {
          ...serializeClip(c),
          likedByMe: likedIds.has(c.id),
          favoritedByMe: favoriteIds.has(c.id),
          coin: serializeCoin(c.coin),
          position: pos ? positionLite(pos, c.coin.priceSol) : null,
        };
      }),
      nextOffset: offset + clips.length,
      total,
      hasMore: offset + clips.length < total,
      solUsd: usd,
      rpc: SOLANA_RPC.replace(/^https?:\/\//, "").split("/")[0],
    },
    { trader, created },
  );
}

/**
 * Load clips by id, returned in the order the ids were given.
 *
 * `findMany({ where: { id: { in } } })` gives no ordering guarantee, so the rows
 * come back in whatever order the database likes. For a shuffled feed that order
 * *is* the product, so it is restored here rather than left to chance.
 */
function loadClips(ids: string[]) {
  if (ids.length === 0) return Promise.resolve([] as ClipWithCoin[]);
  return prisma.clip
    .findMany({ where: { id: { in: ids } }, include: { coin: true } })
    .then((rows) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id)).filter((r): r is ClipWithCoin => Boolean(r));
    });
}

type ClipWithCoin = Awaited<
  ReturnType<typeof prisma.clip.findMany<{ include: { coin: true } }>>
>[number];

import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { VISIBLE_COIN } from "@/lib/visibility";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin, serializeClip, positionLite } from "@/lib/api";
import { readTrader, resolveTrader } from "@/lib/session";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { solUsd } from "@/lib/sol-price";
import { seededShuffle } from "@/lib/shuffle";

export const dynamic = "force-dynamic";

type Sort = "movers" | "new" | "trending";

/**
 * Upper bound on how many clips the shuffle draws from.
 *
 * Bounds worst-case work for the pool query (ids only), not what the feed is
 * *allowed* to show. It must comfortably exceed the catalog: while this was 300,
 * the 300th-ranked clip scored 11.5 and everything below it — 153 of 453 ready
 * clips — could never be served on any rail. Uploaded clips were the worst
 * affected, because a clip on an established coin scores low on the freshness
 * term and landed under the cut permanently; the person who posted it could not
 * see it in the feed at all.
 *
 * The rails' *gates* are what give a sort its meaning under a shuffle (Movers'
 * top 40 movers, Top's market-cap floor, New's window), so a pool that covers
 * the catalog costs the ranking nothing and stops the cap from silently hiding
 * content.
 */
const POOL = 2000;

/** How far back "New" looks. A new token, not a new clip. */
const NEW_WINDOW_MS = 60 * 60_000;

/**
 * How stale a coin's trading activity may be and still count toward Trending.
 *
 * Trending is a claim about *now* — "these are the tokens being traded most".
 * The gate below cannot honour that from the stored number alone: `volume24hSol`
 * is only as fresh as the keeper's last successful measurement of that coin, and
 * for a coin the keeper can no longer price (a graduated token whose pool was
 * pulled, a launch that fell out of the ranking) it is frozen at whatever it was
 * the last time anyone looked. A frozen six-figure volume on a token that has
 * not traded in days is exactly how a dead token sits on a Trending rail forever
 * — seen in production, where a $23-cap coin topped the raw volume sort, last
 * measured 112 hours earlier.
 *
 * So Trending requires the coin to have been *measured* recently. The keeper
 * only writes `lastSyncedAt` when a live source actually answered for the coin,
 * so any coin that fails this check is one we cannot currently price — and a
 * volume we cannot stand behind has no business claiming to be trending.
 *
 * Two hours is generous on purpose: the keeper walks the catalogue round-robin,
 * so a real coin can go an hour or two between measurements, and the metric
 * itself (a trailing 24h window) is already smooth.
 */
const TRENDING_FRESH_MS = 2 * 60 * 60_000;

/**
 * GET /api/feed?sort=movers|new|trending&limit=12&offset=0&seed=<str>&mint=<optional>
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
  // Legacy aliases: a client bundle deployed before a rename may still send the
  // old key, and silently falling back to a different rail would be worse than
  // honouring it. "hot" was Movers' old name; "top" was Trending's.
  const rawSort = sp.get("sort");
  const sort =
    ((rawSort === "hot" ? "movers" : rawSort === "top" ? "trending" : rawSort) as Sort) ||
    "movers";
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
  // Movers, New and Trending rank by a property of the *coin*, not the clip:
  //   Movers — the biggest 24h price change, so it is a gainers board.
  //   New — coins launched most recently.
  //   Trending — the coins actually trading most right now, by 24h volume.
  // `rank` (and then `id`) breaks ties so a wall of equal-scoring coins still has
  // a stable order to permute.
  // A single-token wall is not a ranking, it is a body of work: every clip
  // bound to one mint, newest first. `sort` describes *which tokens* a rail
  // draws from, and here there is only one, so it has no say in the order.
  const orderBy = mint
    ? [{ createdAt: "desc" as const }, { id: "asc" as const }]
    : sort === "new"
      ? [{ coin: { launchedAt: "desc" as const } }, { id: "asc" as const }]
      : sort === "trending"
        ? [{ coin: { volume24hSol: "desc" as const } }, { rank: "desc" as const }, { id: "asc" as const }]
        : sort === "movers"
          ? [{ coin: { change24hPct: "desc" as const } }, { rank: "desc" as const }, { id: "asc" as const }]
          : [{ rank: "desc" as const }, { id: "asc" as const }];

  // SOL/USD rides along on every feed response (the client prices cards in USD),
  // and solUsd() is cached for 60s, so reading it here costs nothing.
  const usd = await solUsd();

  /**
   * The coins that qualify for Trending *right now*, or null when this request
   * is not the Trending rail (or is a single-coin view, where the rail has no
   * say).
   *
   * Two conditions, both about the present: the coin has shown trailing-24h
   * volume, and that reading is recent (see TRENDING_FRESH_MS).
   *
   * Why not a plain `volume24hSol > 0` sort: the stored volume is only as fresh
   * as the keeper's last measurement, and for a coin it can no longer price (a
   * graduated token whose pool was pulled, a launch that fell out of the pump.fun
   * ranking) it is frozen at its last-known value. That is how the rail filled
   * with tokens showing a stale six-figure volume and a $23 market cap. Requiring
   * a recent measurement is the whole gate — no live re-read is needed, because a
   * trailing-24h volume does not need to be verified to the second the way a
   * point-in-time market cap did.
   */
  let trendingCoinIds: string[] | null = null;
  if (sort === "trending" && !mint) {
    const rows = await prisma.coin.findMany({
      where: {
        ...VISIBLE_COIN,
        volume24hSol: { gt: 0 },
        lastSyncedAt: { gte: new Date(Date.now() - TRENDING_FRESH_MS) },
      },
      select: { id: true },
    });
    trendingCoinIds = rows.map((r) => r.id);
  }

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
   * The where-clause, as a function of whether the Movers/Trending gate is applied.
   *
   * Building it twice is what lets the gates fall back: on a catalog the keeper
   * has not measured yet (a fresh deploy, or a very quiet day), every coin would
   * fail the "has it moved" gate and Movers would render an empty wall. Rather
   * than a blank screen, the gate is dropped and the ranked feed shows — the
   * rail still says Movers, but with nothing measured to rank we show the
   * catalog instead of nothing. Still honest: every clip served is a real clip.
   */
  const buildWhere = (gate: boolean) => {
    const coin: Prisma.CoinWhereInput = mint ? { mint } : { ...VISIBLE_COIN };
    if (gate && !mint) {
      // Movers is a gainers board: rank by 24h price change. The gate keeps only
      // coins that have actually moved — a stored 0 means "flat, or never
      // measured" — so the wall is the day's movers rather than the whole
      // catalog. Ranking desc puts the gainers at the top.
      if (sort === "movers") coin.change24hPct = { not: 0 };
      // New is new *tokens*, not new clips — a token launched in the last hour.
      // `launchedAt` is the real launch time; `createdAt` is the fallback for
      // the rare coin pump.fun gave us no launch stamp for.
      if (sort === "new") {
        const cut = new Date(Date.now() - NEW_WINDOW_MS);
        coin.OR = [
          { launchedAt: { gte: cut } },
          { launchedAt: null, createdAt: { gte: cut } },
        ];
      }
      if (sort === "trending") {
        // The fresh, volume-bearing set computed above. An empty array is
        // meaningful — it means nothing is measurably trading — and Trending
        // should show nothing rather than fall back to the catalogue (see the
        // no-fallback note below).
        coin.id = { in: trendingCoinIds ?? [] };
      }
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
  // Trending does NOT fall back to the ungated feed.
  //
  // Movers and New fall back because their gates describe a ranking, and a rail
  // that ranks the whole catalogue on a quiet day is still a truthful answer.
  // Trending's gate is different in kind: it is a claim that these coins are
  // being traded right now, so dropping it would make the heading a lie — a dead
  // coin shown under "Trending". When nothing qualifies, Trending renders empty.
  if (total === 0 && !mint && sort !== "trending") {
    where = buildWhere(false);
    total = await prisma.clip.count({ where });
  }

  /**
   * The clips this viewer uploaded, always.
   *
   * Fetching them separately from `where` is the point: it means they ignore the
   * pool cutoff, the rail's gate and the `since` freeze. Someone who has just
   * posted a clip must be able to find it — being told "it's live" and then
   * never seeing it, because it landed below the ranked cut or after the session
   * cutoff, is indistinguishable from the upload having failed.
   *
   * Skipped on the Following wall, which is defined by who you follow, and on a
   * single-coin view, where the clip would already be there.
   *
   * Read-only on purpose: `readTrader` never creates a row, so an anonymous
   * visitor scrolling cannot trigger a write.
   */
  const ownIds: string[] = [];
  if (!mint && sp.get("scope") !== "following") {
    const viewer = await readTrader();
    if (viewer) {
      const own = await prisma.clip.findMany({
        where: { ready: true, uploadedById: viewer.id, coin: { ...VISIBLE_COIN } },
        select: { id: true },
      });
      ownIds.push(...own.map((c) => c.id));
    }
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
      take: Math.min(POOL, total),
      select: { id: true },
    });

    // Union the viewer's own clips in. A Set both de-duplicates (the clip is
    // usually already in the pool) and, being insertion-ordered, keeps the
    // ranked pool first — the shuffle is over a stable list either way.
    const poolIds = new Set(pool.map((p) => p.id));
    for (const id of ownIds) poolIds.add(id);

    const ids = [...poolIds];
    // `total` is what hasMore compares against, so it has to describe the set we
    // actually page through — otherwise the wall would stop before reaching a
    // clip that was appended.
    total = Math.max(total, ids.length);

    // New, Movers and Trending are ranked rails: the order *is* the meaning
    // ("the latest launches", "the biggest movers", "the most traded"), so the
    // shuffle is skipped and the pool's own order stands. Every other rail
    // permutes, because its order carries no signal a viewer reads.
    const ranked = sort === "new" || sort === "movers" || sort === "trending";
    const seq = ranked
      ? ids.map((id) => ({ id }))
      : seededShuffle(ids.map((id) => ({ id })), seed);
    const page = seq.slice(offset, offset + limit);
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

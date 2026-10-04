import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { VISIBLE_COIN } from "@/lib/visibility";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin, serializeClip, positionLite } from "@/lib/api";
import { readTrader, resolveTrader } from "@/lib/session";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { solUsd } from "@/lib/sol-price";
import { seededShuffle } from "@/lib/shuffle";
import { trendingSeed } from "@/lib/trending-order";
import { mcFreshCutoff } from "@/lib/freshness";

export const dynamic = "force-dynamic";

type Sort = "movers" | "new" | "trending" | "top";

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
 * How stale a coin's trending stamp may be and still count toward Trending.
 *
 * Trending is the Dexscreener board, not a volume sort: the trending ingest
 * (lib/ingest.ts) stamps `trendingAt` on every token on the latest board and
 * clears it from everything that fell off, so membership is a fact the board
 * asserts, refreshed each keeper tick. This window is how long a stamp stays
 * trustworthy if the keeper stops refreshing it — a token that leaves the board
 * loses its stamp on the next tick, but if ticks themselves stop (a dead cron),
 * a stamp older than this must stop counting rather than pinning a token to the
 * rail forever.
 *
 * Two hours against a 5-minute cadence is deliberately generous: it survives a
 * run of failed ticks (a Dexscreener outage leaves the prior board standing)
 * without ever keeping something the board has dropped.
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
  // Legacy alias: a client bundle deployed before a rename may still send the
  // old key, and silently falling back to a different rail would be worse than
  // honouring it. "hot" was Movers' old name. "top" is NOT aliased — it is a
  // real rail again (market cap), the same meaning it had before the rename.
  const rawSort = sp.get("sort");
  const sort = ((rawSort === "hot" ? "movers" : rawSort) as Sort) || "movers";
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
  // Movers, New, Trending and Top rank by a property of the *coin*, not the clip:
  //   Movers — the biggest 24h price change, so it is a gainers board.
  //   New — coins launched most recently.
  //   Trending — what the Dexscreener board is trending right now.
  //   Top — the largest market caps, so the big tokens are always showcased
  //         (Trending no longer surfaces them, because it is the board).
  // `rank` (and then `id`) breaks ties so a wall of equal-scoring coins still has
  // a stable order to permute.
  // A single-token wall is not a ranking, it is a body of work: every clip
  // bound to one mint, newest first. `sort` describes *which tokens* a rail
  // draws from, and here there is only one, so it has no say in the order.
  const orderBy = mint
    ? [{ createdAt: "desc" as const }, { id: "asc" as const }]
    : sort === "new"
      ? [{ coin: { launchedAt: "desc" as const } }, { id: "asc" as const }]
      : sort === "top"
        ? [{ coin: { marketCapSol: "desc" as const } }, { rank: "desc" as const }, { id: "asc" as const }]
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
   * One condition: the coin carries a trending stamp the ingest wrote within
   * the freshness window (see TRENDING_FRESH_MS). The stamp is the Dexscreener
   * board's own membership decision — a coin is trending because the board said
   * so this tick, not because a volume number happened to be large.
   *
   * Why not a `volume24hSol > 0` sort: the stored volume is only as fresh as
   * the keeper's last measurement of that coin, and for one it can no longer
   * price it freezes at its last value. That is how the rail filled with tokens
   * showing a stale six-figure volume and a $23 market cap. The stamp is
   * refreshed (and cleared) by the ingest itself, so it cannot go stale the same
   * way.
   */
  let trendingCoinIds: string[] | null = null;
  if (sort === "trending" && !mint) {
    // Membership is the trending stamp the ingest wrote — not a stored volume.
    // A coin is on Trending because the Dexscreener board named it this tick,
    // and the stamp is the record of that; ranking a stale volume is exactly how
    // a token that left the board used to keep sitting on the rail.
    const rows = await prisma.coin.findMany({
      where: {
        ...VISIBLE_COIN,
        trendingAt: { gte: new Date(Date.now() - TRENDING_FRESH_MS) },
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

  // A user's clip supersedes every non-user clip for the same token.
  //
  // Two kinds of clip are not "real user" content: the art-only placeholder a
  // freshly-ingested token gets (videoUrl null, author "unclaimed"), and the
  // seeded catalogue clip (a rendered video, also author "unclaimed"). Both are
  // our content, not someone's. The moment a real uploader posts a clip for a
  // token, their clip is what should show — never ours, and never both at once
  // (which is what put @unclaimed and a user's clip back-to-back on the wall).
  //
  // So: any clip with an uploader (uploadedById set) is a user clip; for a coin
  // that has one, hide every clip without an uploader. Enforced here at read
  // time, so it holds for placeholders AND seeds regardless of write paths, and
  // on every rail and the single-token wall. Small set: only coins with a real
  // upload.
  const userClipCoinIds = (
    await prisma.clip.findMany({
      where: { ready: true, uploadedById: { not: null } },
      select: { coinId: true },
      distinct: ["coinId"],
    })
  ).map((c) => c.coinId);

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
      // Top is a market-cap leaderboard, so it may only rank on a cap the keeper
      // measured recently. A coin whose pool vanished can never be re-measured,
      // so its last cap is frozen forever — and ranking on it parked a dead coin
      // at #1. See lib/freshness.ts.
      if (sort === "top") coin.lastSyncedAt = { gte: mcFreshCutoff() };
    }
    return {
      ready: true,
      coin,
      // For a coin with a real user clip, hide every non-user clip (placeholders
      // and seeded clips alike) — see userClipCoinIds above. User videos take
      // precedence, on every rail and on the single-token wall.
      ...(userClipCoinIds.length
        ? { NOT: { uploadedById: null, coinId: { in: userClipCoinIds } } }
        : {}),
      ...(since ? { createdAt: { lte: since } } : {}),
      ...social,
    };
  };

  let where = buildWhere(true);
  let total = await prisma.clip.count({ where });
  // Trending and Top do NOT fall back to the ungated feed.
  //
  // Movers and New fall back because their gates describe a ranking, and a rail
  // that ranks the whole catalogue on a quiet day is still a truthful answer.
  //
  // Trending's gate is different in kind: it is a claim that these coins are
  // being traded right now, so dropping it would make the heading a lie — a dead
  // coin shown under "Trending".
  //
  // Top's gate is freshness, for the same reason: it claims "the biggest caps we
  // can stand behind". Dropping the gate to fill an empty board would put the
  // frozen cap of a dead coin straight back at #1 — the exact bug it exists to
  // prevent. An empty Top is the honest answer.
  if (total === 0 && !mint && sort !== "trending" && sort !== "top") {
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

  if (seed || sort === "trending") {
    // Trending always takes this path, even with no client seed. Its order is
    // the hour permutation (below), not a ranked or client-driven one, so it
    // must not fall through to the plain windowed query — that would order it by
    // volume and leak the boost board's ranking back onto the rail.
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

    // New, Movers and Top are ranked rails: the order *is* the meaning ("the
    // latest launches", "the biggest movers", "the biggest caps"), so the
    // shuffle is skipped and the pool's own order stands.
    //
    // Trending is the exception. Its *members* come from the Dexscreener board,
    // but the board's own order is a boost leaderboard — it reads top-to-bottom
    // as "who paid the most", so ranking by it turns the rail into an advert.
    // Trending is therefore permuted too, on the hour bucket rather than the
    // visitor's session seed: one order for everyone, stable enough to page
    // through, rotating once an hour (see lib/trending-order.ts).
    const ranked = sort === "new" || sort === "movers" || sort === "top";
    const shuffleSeed = sort === "trending" ? trendingSeed() : seed;
    const seq = ranked
      ? ids.map((id) => ({ id }))
      : seededShuffle(ids.map((id) => ({ id })), shuffleSeed);
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

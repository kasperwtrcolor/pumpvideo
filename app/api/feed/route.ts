import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { VISIBLE_COIN } from "@/lib/visibility";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin, serializeClip, positionLite } from "@/lib/api";
import { readTrader, resolveTrader } from "@/lib/session";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { solUsd } from "@/lib/sol-price";
import { quotesFor } from "@/lib/quotes";
import { seededShuffle } from "@/lib/shuffle";

export const dynamic = "force-dynamic";

type Sort = "hot" | "new" | "top";

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
 * The rails' *gates* are what give a sort its meaning under a shuffle (Hot's
 * top 40 gainers, Top's market-cap floor, New's window), so a pool that covers
 * the catalog costs the ranking nothing and stops the cap from silently hiding
 * content.
 */
const POOL = 2000;

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

/** How far back "New" looks. A new token, not a new clip. */
const NEW_WINDOW_MS = 30 * 60_000;

/** "Top" means a market cap of at least this many USD. */
const TOP_MIN_USD = 100_000;

/**
 * How stale a coin's stored market state may be and still count toward Top.
 *
 * Top is a claim about *now* — "these tokens are worth $100k+". The gate below
 * cannot honour that from the stored number alone: `marketCapSol` is only as
 * fresh as the keeper's last successful measurement of that coin, and for a coin
 * the keeper can no longer price (a graduated token whose pool was pulled, an
 * on-curve launch that fell out of the ranking) it is frozen at whatever it was
 * the last time anyone looked. A frozen $375M cap on a token that rugged weeks
 * ago is exactly how a dead token sits at the top of the Top rail forever.
 *
 * So Top requires the coin to have been *measured* recently. The keeper only
 * writes `lastSyncedAt` when a live source actually answered for the coin (see
 * lib/keeper.ts), so any coin that fails this check is one we cannot currently
 * price — and a price we cannot stand behind has no business claiming $100k.
 *
 * The window is six keeper ticks (the keeper samples every five minutes), so one
 * transient source outage does not knock a real coin off the rail.
 */
const TOP_FRESH_MS = 30 * 60_000;

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
  // Hot, New and Top rank by a property of the *coin*, not the clip:
  //   Hot — the biggest 5-minute *increase*, so it is a gainers board.
  //   New — coins launched most recently.
  //   Top — the largest market caps.
  // `rank` (and then `id`) breaks ties so a wall of equal-scoring coins still has
  // a stable order to permute.
  const orderBy =
    sort === "new"
      ? [{ coin: { launchedAt: "desc" as const } }, { id: "asc" as const }]
      : sort === "top"
        ? [{ coin: { marketCapSol: "desc" as const } }, { rank: "desc" as const }, { id: "asc" as const }]
        : sort === "hot"
          ? [{ coin: { change5mPct: "desc" as const } }, { rank: "desc" as const }, { id: "asc" as const }]
          : [{ rank: "desc" as const }, { id: "asc" as const }];

  // SOL/USD is needed up here because the Top floor is a USD figure and market
  // caps are stored in SOL. Cached for 60s inside solUsd(), so this costs
  // nothing even though the ticker route calls it too.
  const usd = await solUsd();

  /**
   * The coins that genuinely clear the Top floor *right now*, or null when this
   * request is not the Top rail (or is a single-coin view, where the rail has no
   * say).
   *
   * Why this exists rather than a plain `marketCapSol >= floor` filter: the
   * stored cap is only as fresh as the keeper's last measurement, and for any
   * coin the keeper can no longer price it is frozen at its last-known value.
   * A graduated token whose pool was pulled — Dexscreener answers nothing for it
   * ever again — keeps its old high cap indefinitely, and with it a permanent
   * seat on Top. Filtering on that number is how the rail filled with tokens
   * showing $2k in the ticker but clearing a $100k gate in the query.
   *
   * So the gate is measured, not remembered: the coins are narrowed cheaply in
   * SQL (graduated, above the floor, measured recently), then each candidate's
   * cap is re-read live and only the ones Dexscreener can genuinely price at
   * $100k+ survive. The result is the same number the ticker will show, so the
   * rail and the price on each card can never disagree.
   *
   * `quotesFor` caches per mint for ~12s, so a scrolling client does not fan out
   * one Dexscreener call per page.
   */
  let topCoinIds: string[] | null = null;
  if (sort === "top" && !mint) {
    const floor = TOP_MIN_USD / usd;
    const candidates = await prisma.coin.findMany({
      where: {
        ...VISIBLE_COIN,
        // Only a graduated token has an AMM pool, and only a pooled token can be
        // worth $100k+: the bonding curve tops out far below the floor. So this
        // is not narrowing the field, it is stating the precondition.
        complete: true,
        marketCapSol: { gte: floor },
        lastSyncedAt: { gte: new Date(Date.now() - TOP_FRESH_MS) },
      },
      select: { id: true, mint: true },
    });
    const quotes = await quotesFor(candidates.map((c) => c.mint));
    topCoinIds = candidates
      .filter((c) => {
        const q = quotes[c.mint];
        // `live` false means the keeper's cached number stood in for a missing
        // Dexscreener quote — i.e. we could not verify it, so it does not count.
        return q != null && q.live && q.marketCapSol >= floor;
      })
      .map((c) => c.id);
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
    const coin: Prisma.CoinWhereInput = mint ? { mint } : { ...VISIBLE_COIN };
    if (gate && !mint) {
      // Hot is a gainers board: coins that are *up* over the last five minutes,
      // biggest rise first. A coin that fell is not hot, it is just down.
      if (sort === "hot") coin.change5mPct = { gt: 0 };
      // New is new *tokens*, not new clips — a token launched in the last half
      // hour. `launchedAt` is the real launch time; `createdAt` is the fallback
      // for the rare coin pump.fun gave us no launch stamp for.
      if (sort === "new") {
        const cut = new Date(Date.now() - NEW_WINDOW_MS);
        coin.OR = [
          { launchedAt: { gte: cut } },
          { launchedAt: null, createdAt: { gte: cut } },
        ];
      }
      if (sort === "top") {
        // The verified set computed above. An empty array is meaningful — it
        // means nothing clears $100k today, and Top should show nothing rather
        // than fall back to the catalogue (see the no-fallback note below).
        coin.id = { in: topCoinIds ?? [] };
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
  // Top does NOT fall back to the ungated feed.
  //
  // Hot and New fall back because their gates describe a ranking, and a rail
  // that ranks the whole catalogue on a quiet day is still a truthful answer.
  // Top's gate is different in kind: it is a promise about the tokens ("$100k
  // plus"), and dropping it would not merely re-rank the rail, it would make it
  // lie — a $2k token shown under a heading that says $100k+. So when nothing
  // clears the floor, Top renders empty.
  if (total === 0 && !mint && sort !== "top") {
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
      // Hot permutes only its top gainers, so the wall is a gainers board even
      // after the shuffle; every other rail permutes the whole working set.
      take: sort === "hot" ? Math.min(HOT_POOL, total) : Math.min(POOL, total),
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

    const page = seededShuffle(ids.map((id) => ({ id })), seed).slice(offset, offset + limit);
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

import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin } from "@/lib/api";
import { VISIBLE_COIN } from "@/lib/visibility";
import { seededShuffle } from "@/lib/shuffle";
import { trendingSeed } from "@/lib/trending-order";

export const dynamic = "force-dynamic";

/** A coin row with its ready-clip count, the shape both branches below produce. */
type CoinWithClips = Prisma.CoinGetPayload<{
  include: { _count: { select: { clips: true } } };
}>;

const CLIP_COUNT_INCLUDE = {
  _count: { select: { clips: { where: { ready: true } } } },
};

/**
 * How far back the "New" tab looks, measured on the coin's launch time. Matches
 * the feed rail's window exactly, so the two "New" surfaces cannot disagree.
 */
const NEW_WINDOW_MS = 60 * 60_000;

/**
 * How stale a coin's trending stamp may be and still count toward Trending.
 * Matches the feed rail's gate exactly (see app/api/feed/route.ts), so the two
 * "Trending" surfaces cannot disagree: a coin is trending because the
 * Dexscreener board's most recent read named it (the `trendingAt` stamp the
 * ingest writes), not because a stored volume happened to be large.
 */
const TRENDING_FRESH_MS = 2 * 60 * 60_000;

/**
 * GET /api/coins?sort=top|movers|new|trending|clips&limit=24&offset=0&q=dog&graduated=0
 * Browsable coin index — the "Coins" tab.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // Legacy alias for the renamed rail: "hot" was Movers' old name. "top" is a
  // real sort again — the biggest market caps — so it is not remapped.
  const rawSort = sp.get("sort");
  const sort = rawSort === "hot" ? "movers" : rawSort || "top";
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit")) || 24));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const q = (sp.get("q") || "").trim();
  const graduatedOnly = sp.get("graduated") === "1";

  // Every ordering carries `id` as a final tiebreaker, so a coin sitting on the
  // same rank/timestamp cannot shuffle between pages and be dropped or repeated.
  //
  // New sorts on `launchedAt` (the real launch), NOT `createdAt` (when we
  // ingested the row). Ordering by ingest time with no time window is how the
  // tab filled with day-old tokens: a coin pulled into the catalogue hours after
  // it launched looked "new" purely because we had just added it.
  const orderBy: Prisma.CoinOrderByWithRelationInput[] =
    sort === "new"
      ? [{ launchedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }]
      : sort === "top"
        ? [{ marketCapSol: "desc" }, { id: "asc" }]
        : sort === "trending"
          ? [{ volume24hSol: "desc" }, { id: "asc" }]
          : sort === "clips"
            ? [{ clips: { _count: "desc" } }, { id: "asc" }]
            : sort === "movers"
              ? [{ change24hPct: "desc" }, { id: "asc" }]
              : [{ marketCapSol: "desc" }, { id: "asc" }];

  const filters: Prisma.CoinWhereInput[] = [];
  if (graduatedOnly) filters.push({ complete: true });
  if (sort === "movers") {
    // Same definition as the feed rail: a coin must have actually moved. A
    // stored 0 means "flat, or never measured", and the two must not be mixed —
    // one label must mean one thing on every surface that implements it.
    filters.push({ change24hPct: { not: 0 } });
  }
  if (sort === "new") {
    // The "New" tab is a window on launch time — a token launched in the last
    // hour — mirroring the feed rail. `launchedAt` is the real launch; `createdAt`
    // is the fallback for the rare coin pump.fun gave us no launch stamp for.
    const cut = new Date(Date.now() - NEW_WINDOW_MS);
    filters.push({
      OR: [
        { launchedAt: { gte: cut } },
        { launchedAt: null, createdAt: { gte: cut } },
      ],
    });
  }
  if (sort === "trending") {
    // Same definition as the feed rail: the coin carries a trending stamp the
    // ingest wrote within the freshness window. The stamp is the board's own
    // membership decision, cleared automatically when a token drops off — so a
    // coin cannot sit on the rail on a stale volume. One label, one meaning, on
    // every surface.
    filters.push({ trendingAt: { gte: new Date(Date.now() - TRENDING_FRESH_MS) } });
  }
  if (q) {
    filters.push({
      OR: [
        { name: { contains: q } },
        { symbol: { contains: q } },
        { mint: { contains: q } },
      ],
    });
  }

  const where: Prisma.CoinWhereInput = {
    ...VISIBLE_COIN,
    ...(filters.length ? { AND: filters } : {}),
  };

  // The include the rows carry, shared by both branches below.
  const include = CLIP_COUNT_INCLUDE;

  let coins: CoinWithClips[];
  let total: number;

  if (sort === "trending") {
    // Trending is permuted on the hour bucket (see lib/trending-order.ts). The
    // board's own order is a boost leaderboard, so ranking by it turns the tab
    // into an advert that reads top-to-bottom as "who paid the most". The set is
    // small — a board of a few dozen mints — so it is read whole and permuted in
    // memory, then the page is sliced out. Doing it in SQL cannot work: the
    // permutation has to be byte-identical across pages, and an ORDER BY cannot
    // express a seeded shuffle.
    const all = await prisma.coin.findMany({ where, orderBy, include });
    const shuffled = seededShuffle(all, trendingSeed());
    total = shuffled.length;
    coins = shuffled.slice(offset, offset + limit);
  } else {
    [coins, total] = await Promise.all([
      prisma.coin.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        include,
      }),
      prisma.coin.count({ where }),
    ]);
  }

  return withTrader({
    items: coins.map((c) => ({
      ...serializeCoin(c),
      clipCount: c._count.clips,
      clip: c._count.clips > 0 ? `/clips/${c.mint}.mp4` : null,
    })),
    nextOffset: offset + coins.length,
    total,
  });
}

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin, serializeClip, positionLite } from "@/lib/api";
import { resolveTrader } from "@/lib/session";
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
  const orderBy =
    sort === "new"
      ? [{ createdAt: "desc" as const }, { id: "asc" as const }]
      : sort === "top"
        ? [{ coin: { marketCapSol: "desc" as const } }, { id: "asc" as const }]
        : [{ rank: "desc" as const }, { id: "asc" as const }];

  const where = {
    ready: true,
    coin: mint ? { mint } : { isBanned: false },
    ...(since ? { createdAt: { lte: since } } : {}),
  };

  const total = await prisma.clip.count({ where });

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

  const usd = await solUsd();

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

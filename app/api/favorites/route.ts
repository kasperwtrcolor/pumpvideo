import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { serializeClip, serializeCoin, positionLite } from "@/lib/api";
import { solUsd } from "@/lib/sol-price";
import { isVisibleCoin } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/**
 * GET /api/favorites?limit=20&offset=0
 *
 * The caller's saved clips, most recently saved first.
 *
 * Login-gated rather than cookie-gated: saving requires a verified identity, so
 * an anonymous visitor has no list to read and gets a clean 401 instead of an
 * empty page that looks like a bug.
 *
 * Ordered by the ClipFavorite row's own `createdAt`, not by feed rank — the
 * question this answers is "what did I save", so popularity is irrelevant.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);

  const [rows, total, usd] = await Promise.all([
    prisma.clipFavorite.findMany({
      where: { traderId: trader.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      skip: offset,
      include: { clip: { include: { coin: true } } },
    }),
    prisma.clipFavorite.count({ where: { traderId: trader.id } }),
    solUsd(),
  ]);

  // Only surface clips that are still servable. A saved clip whose coin got
  // banned (pump.fun moderation) or whose row was deleted should not appear.
  //
  // Paging stays over the *favourite rows*, not the visible items: `nextOffset`
  // advances by `rows.length` and `total` is the raw favourite count. If it
  // advanced by visible items instead, the offset would drift behind the rows it
  // claimed to have consumed and the pager would loop over the same page.
  // The cost is that a page containing a hidden clip renders fewer cards — which
  // is the honest outcome, not a bug.
  // Positions for the coins on this page, so each row can be coloured against
  // the viewer's own entry price rather than a generic 24h change.
  const coinIds = rows.filter((r) => r.clip.ready && isVisibleCoin(r.clip.coin)).map((r) => r.clip.coinId);
  const positions = coinIds.length
    ? await prisma.position.findMany({
        where: { traderId: trader.id, coinId: { in: coinIds } },
        select: { coinId: true, tokenAmount: true, costSol: true },
      })
    : [];
  const positionByCoin = new Map(positions.map((p) => [p.coinId, p]));

  const items = rows
    .filter((r) => r.clip.ready && isVisibleCoin(r.clip.coin))
    .map((r) => {
      const pos = positionByCoin.get(r.clip.coinId);
      return {
        ...serializeClip(r.clip),
        likedByMe: false,
        favoritedByMe: true,
        coin: serializeCoin(r.clip.coin),
        position: pos ? positionLite(pos, r.clip.coin.priceSol) : null,
        savedAt: r.createdAt.toISOString(),
      };
    });

  return NextResponse.json({
    items,
    nextOffset: offset + rows.length,
    total,
    hasMore: offset + rows.length < total,
    solUsd: usd,
  });
}

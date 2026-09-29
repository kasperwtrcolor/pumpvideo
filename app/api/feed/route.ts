import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin, serializeClip } from "@/lib/api";
import { resolveTrader } from "@/lib/session";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { solUsd } from "@/lib/sol-price";

export const dynamic = "force-dynamic";

type Sort = "hot" | "new" | "top";

/**
 * GET /api/feed?sort=hot|new|top&limit=12&offset=0&mint=<optional>
 *
 * Returns clips stitched to their coin. This is the single payload the vertical
 * swiper renders per page — video URL, caption, coin market state, trader balance.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sort = (sp.get("sort") as Sort) || "hot";
  const limit = Math.min(24, Math.max(1, Number(sp.get("limit")) || 12));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const mint = sp.get("mint");

  const orderBy =
    sort === "new"
      ? { createdAt: "desc" as const }
      : sort === "top"
        ? { coin: { marketCapSol: "desc" as const } }
        : { rank: "desc" as const };

  const clips = await prisma.clip.findMany({
    where: {
      ready: true,
      coin: mint ? { mint } : { isBanned: false },
    },
    include: { coin: true },
    orderBy,
    take: limit,
    skip: offset,
  });

  const [total, usd] = await Promise.all([
    prisma.clip.count({
      where: { ready: true, coin: mint ? { mint } : { isBanned: false } },
    }),
    solUsd(),
  ]);

  // Who is asking? Resolved once, here, and threaded through withTrader — calling
  // it twice inside one request would mint two trader rows and point the cookie
  // at the wrong one.
  const { trader, created } = await resolveTrader();

  const likedIds = trader
    ? new Set(
        (
          await prisma.clipLike.findMany({
            where: { traderId: trader.id, clipId: { in: clips.map((c) => c.id) } },
            select: { clipId: true },
          })
        ).map((r) => r.clipId),
      )
    : new Set<string>();

  return withTrader(
    {
      items: clips.map((c) => ({
        ...serializeClip(c),
        likedByMe: likedIds.has(c.id),
        coin: serializeCoin(c.coin),
      })),
      nextOffset: offset + clips.length,
      total,
      hasMore: offset + clips.length < total,
      solUsd: usd,
      rpc: SOLANA_RPC.replace(/^https?:\/\//, "").split("/")[0],
    },
    { trader, created },
  );
}

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";
import { pointsFor } from "@/lib/points";
import type { PointStats } from "@/lib/points";

export const dynamic = "force-dynamic";

/**
 * GET /api/leaderboard?limit=50 — traders ranked by Pemp Points.
 *
 * Four aggregate reads and one pass in memory, rather than a score column on
 * `Trader`. The score is derived from facts that already move independently
 * (likes land, trades settle, follows happen), so keeping it as a stored column
 * would mean updating it from every write path that touches any of them — and
 * the first missed path would silently freeze a user's rank. Deriving it means
 * the board is correct by construction, and the weights can change without a
 * migration.
 *
 * Only rows with points > 0 are returned. The table carries an anonymous trader
 * for every visitor cookie ever minted, so an unfiltered board would be a list
 * of nameless zeros.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));

  const [traders, clipAgg, tradeAgg, rewardAgg] = await Promise.all([
    prisma.trader.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        followerCount: true,
        walletAddress: true,
      },
    }),
    // Everything the trader's own clips earned. Denormalised counters on Clip,
    // so this is one grouped read rather than a join through every ClipLike row.
    prisma.clip.groupBy({
      by: ["uploadedById"],
      where: { uploadedById: { not: null } },
      _count: { _all: true },
      _sum: { likes: true, comments: true, shares: true },
    }),
    prisma.trade.groupBy({
      by: ["traderId"],
      _count: { _all: true },
      _sum: { solAmount: true },
    }),
    // The creator cut, keyed by wallet — it is paid to `creatorWallet`, not to a
    // trader row, so a trader is matched to their earnings by wallet address.
    prisma.trade.groupBy({
      by: ["creatorWallet"],
      where: { creatorWallet: { not: null } },
      _sum: { creatorFeeSol: true },
    }),
  ]);

  const clipBy = new Map(clipAgg.map((c) => [c.uploadedById as string, c]));
  const tradeBy = new Map(tradeAgg.map((t) => [t.traderId, t]));
  const rewardBy = new Map(rewardAgg.map((r) => [r.creatorWallet as string, r._sum.creatorFeeSol ?? 0]));

  const scored = traders.map((t) => {
    const c = clipBy.get(t.id);
    const tr = tradeBy.get(t.id);
    const stats: PointStats = {
      clips: c?._count._all ?? 0,
      likes: c?._sum.likes ?? 0,
      comments: c?._sum.comments ?? 0,
      shares: c?._sum.shares ?? 0,
      followers: t.followerCount,
      trades: tr?._count._all ?? 0,
      volumeSol: tr?._sum.solAmount ?? 0,
      rewardsSol: t.walletAddress ? (rewardBy.get(t.walletAddress) ?? 0) : 0,
    };
    const { total, lines } = pointsFor(stats);
    return {
      id: t.id,
      /** Public slug — the username when claimed, the row id otherwise. Never `handle`. */
      slug: t.username ?? t.id,
      name: t.displayName ?? t.username ?? "anon",
      username: t.username,
      avatarUrl: t.avatarUrl,
      points: total,
      stats,
      lines,
    };
  });

  const ranked = scored
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  return withTrader({
    total: ranked.length,
    entries: ranked.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e })),
  });
}

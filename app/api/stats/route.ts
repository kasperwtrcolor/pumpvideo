import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";
import { solUsd } from "@/lib/sol-price";
import { VISIBLE_COIN } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** GET /api/stats — the header numbers. Real counts from the DB, not decoration. */
export async function GET() {
  const [coins, clips, graduated, agg, traders, trades, rewards] = await Promise.all([
    prisma.coin.count({ where: { ...VISIBLE_COIN } }),
    prisma.clip.count({ where: { coin: { ...VISIBLE_COIN } } }),
    prisma.coin.count({ where: { complete: true, ...VISIBLE_COIN } }),
    prisma.coin.aggregate({
      where: { ...VISIBLE_COIN },
      _sum: { marketCapSol: true, volume24hSol: true },
      _avg: { change24hPct: true },
    }),
    prisma.trader.count(),
    prisma.trade.count(),
    // Everything the app has paid out to creators as the 1% clip cut. The number
    // people are shown must be what actually moved on-chain, so it is summed from
    // the recorded creator legs and nothing else. The `gt: 0` filter matters for
    // the count: a sell (or a creator-less buy) carries no creator leg and must
    // not inflate "buys that paid a creator".
    prisma.trade.aggregate({
      where: { creatorFeeSol: { gt: 0 } },
      _sum: { creatorFeeSol: true },
      _count: { _all: true },
    }),
  ]);

  const usd = await solUsd();

  return withTrader({
    coins,
    clips,
    graduated,
    totalMarketCapSol: agg._sum.marketCapSol ?? 0,
    totalMarketCapUsd: (agg._sum.marketCapSol ?? 0) * usd,
    volume24hSol: agg._sum.volume24hSol ?? 0,
    avgChange24hPct: agg._avg.change24hPct ?? 0,
    traders,
    trades,
    /** Total SOL paid to creators across the app. */
    rewardsPaidSol: rewards._sum.creatorFeeSol ?? 0,
    /** How many buys have paid a creator. */
    rewardsPaidCount: rewards._count._all ?? 0,
    solUsd: usd,
  });
}

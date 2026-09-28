import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";
import { solUsd } from "@/lib/sol-price";

export const dynamic = "force-dynamic";

/** GET /api/stats — the header numbers. Real counts from the DB, not decoration. */
export async function GET() {
  const [coins, clips, graduated, agg, traders, trades] = await Promise.all([
    prisma.coin.count({ where: { isBanned: false } }),
    prisma.clip.count(),
    prisma.coin.count({ where: { complete: true, isBanned: false } }),
    prisma.coin.aggregate({
      where: { isBanned: false },
      _sum: { marketCapSol: true, volume24hSol: true },
      _avg: { change24hPct: true },
    }),
    prisma.trader.count(),
    prisma.trade.count(),
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
    solUsd: usd,
  });
}

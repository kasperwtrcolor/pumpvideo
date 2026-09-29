import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin, serializeClip } from "@/lib/api";
import { rawTokensToUi } from "@/lib/bonding-curve";
import { resolveTrader } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/coins/[symbol]
 * Coin detail: market state, its clips, recent trades, and the caller's position.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await ctx.params;
  const { trader, created } = await resolveTrader();

  const coin = await prisma.coin.findFirst({
    where: { OR: [{ symbol }, { mint: symbol }] },
    include: { clips: { orderBy: { rank: "desc" }, take: 12 } },
  });

  if (!coin) {
    return withTrader(
      { error: "NO_COIN", detail: `no coin matching ${symbol}` },
      { status: 404, trader, created },
    );
  }

  const trades = await prisma.trade.findMany({
    where: { coinMint: coin.mint },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { trader: { select: { handle: true } } },
  });

  const position = await prisma.position.findUnique({
    where: { traderId_coinId: { traderId: trader.id, coinId: coin.id } },
  });

  const held = position ? rawTokensToUi(position.tokenAmount) : 0;

  return withTrader(
    {
      coin: serializeCoin(coin),
      clips: coin.clips.map(serializeClip),
      trades: trades.map((t) => ({
        side: t.side,
        symbol: t.symbol,
        solAmount: t.solAmount,
        priceSol: t.priceSol,
        handle: t.trader.handle.replace(/^anon-/, "").slice(0, 6),
        at: t.createdAt,
      })),
      position: position
        ? {
            tokens: held,
            costSol: position.costSol,
            valueSol: held * coin.priceSol,
            pnlSol: held * coin.priceSol - position.costSol,
            pnlPct:
              position.costSol > 0
                ? ((held * coin.priceSol - position.costSol) / position.costSol) * 100
                : 0,
          }
        : null,
    },
    { trader, created },
  );
}

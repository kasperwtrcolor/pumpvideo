import { withTrader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { resolveTrader } from "@/lib/session";
import { rawTokensToUi } from "@/lib/bonding-curve";

export const dynamic = "force-dynamic";

/**
 * GET /api/account — practice wallet, positions marked to live curve price, PnL.
 * This is the "portfolio" surface: what you'd hold if every clip you bought filled.
 */
export async function GET() {
  const { trader, created } = await resolveTrader();

  const positions = await prisma.position.findMany({
    where: { traderId: trader.id },
    include: { coin: true },
    orderBy: { updatedAt: "desc" },
  });

  const rows = positions.map((p) => {
    const tokens = rawTokensToUi(p.tokenAmount);
    const valueSol = tokens * p.coin.priceSol;
    return {
      mint: p.coin.mint,
      symbol: p.coin.symbol,
      name: p.coin.name,
      imageUrl: p.coin.imageUrl,
      clip: `/clips/${p.coin.mint}.mp4`,
      tokens,
      costSol: p.costSol,
      priceSol: p.coin.priceSol,
      marketCapSol: p.coin.marketCapSol,
      complete: p.coin.complete,
      valueSol,
      pnlSol: valueSol - p.costSol,
      pnlPct: p.costSol > 0 ? ((valueSol - p.costSol) / p.costSol) * 100 : 0,
    };
  });

  const holdingsValue = rows.reduce((s, r) => s + r.valueSol, 0);
  const cost = rows.reduce((s, r) => s + r.costSol, 0);
  const equity = trader.practiceBalance + holdingsValue;

  const recentTrades = await prisma.trade.findMany({
    where: { traderId: trader.id },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return withTrader({
    equity,
    cashSol: trader.practiceBalance,
    holdingsValue,
    costBasis: cost,
    realizedSol: positions.reduce((s, p) => s + p.realizedSol, 0),
    pnlSol: equity - trader.practiceStartBal,
    pnlPct:
      trader.practiceStartBal > 0
        ? ((equity - trader.practiceStartBal) / trader.practiceStartBal) * 100
        : 0,
    positions: rows,
    trades: recentTrades.map((t) => ({
      id: t.id,
      side: t.side,
      symbol: t.symbol,
      mode: t.mode,
      solAmount: t.solAmount,
      priceSol: t.priceSol,
      at: t.createdAt,
    })),
  }, { trader, created });
}

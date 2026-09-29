import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { withTrader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { resolveTrader } from "@/lib/session";
import { rawTokensToUi } from "@/lib/bonding-curve";
import { SOLANA_RPC } from "@/lib/pumpfun";

export const dynamic = "force-dynamic";

/**
 * GET /api/account — the trader's live book.
 *
 * Positions are a mirror of what the wallet actually holds, written from the
 * on-chain balance delta each time a live fill is confirmed. They exist so the
 * portfolio can render in one DB read instead of one RPC call per coin.
 *
 * The SOL balance is read live from chain, because that is the number that must
 * never be stale — unlike the positions, it changes without us doing anything.
 */
export async function GET() {
  const { trader, created } = await resolveTrader();

  const positions = await prisma.position.findMany({
    where: { traderId: trader.id },
    include: { coin: { include: { clips: { orderBy: { rank: "desc" }, take: 1 } } } },
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
      clip: p.coin.clips?.[0]?.videoUrl ?? null,
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
  const costBasis = rows.reduce((s, r) => s + r.costSol, 0);

  // Live wallet balance. A failure here must not take the whole portfolio down.
  let walletSol: number | null = null;
  if (trader.walletAddress) {
    try {
      const conn = new Connection(SOLANA_RPC, "confirmed");
      const lamports = await conn.getBalance(new PublicKey(trader.walletAddress));
      walletSol = lamports / LAMPORTS_PER_SOL;
    } catch {
      walletSol = null;
    }
  }

  const recentTrades = await prisma.trade.findMany({
    where: { traderId: trader.id },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return withTrader(
    {
      walletAddress: trader.walletAddress,
      walletSol,
      holdingsValue,
      costBasis,
      realizedSol: positions.reduce((s, p) => s + p.realizedSol, 0),
      pnlSol: holdingsValue - costBasis,
      pnlPct: costBasis > 0 ? ((holdingsValue - costBasis) / costBasis) * 100 : 0,
      positions: rows,
      trades: recentTrades.map((t) => ({
        id: t.id,
        side: t.side,
        symbol: t.symbol,
        mode: t.mode,
        solAmount: t.solAmount,
        priceSol: t.priceSol,
        txSig: t.txSig,
        at: t.createdAt,
      })),
    },
    { trader, created },
  );
}

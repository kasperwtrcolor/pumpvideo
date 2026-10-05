import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/trades?limit=40 — the most recent fills across every coin.
 *
 * The desktop feed's "live trades" tape. Newest-first off the Trade log, whose
 * `[coinMint, createdAt]` index carries the scan. Coin art is back-filled in one
 * follow-up query rather than one per row — the Trade model denormalises
 * `symbol` but not the image, and a per-row lookup on a 5s poll is the wasteful
 * version of this.
 *
 * `symbol` rides on the row already, so a trade for a coin we have since hidden
 * still renders with a label rather than a blank.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 40));

  const rows = await prisma.trade.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      side: true,
      symbol: true,
      coinMint: true,
      solAmount: true,
      createdAt: true,
      trader: { select: { username: true, displayName: true } },
    },
  });

  const mints = [...new Set(rows.map((r) => r.coinMint))];
  const coins = mints.length
    ? await prisma.coin.findMany({
        where: { mint: { in: mints } },
        select: { mint: true, imageUrl: true },
      })
    : [];
  const art = new Map(coins.map((c) => [c.mint, c.imageUrl]));

  return withTrader({
    trades: rows.map((r) => ({
      id: r.id,
      side: r.side,
      symbol: r.symbol,
      mint: r.coinMint,
      imageUrl: art.get(r.coinMint) ?? null,
      solAmount: r.solAmount,
      who: r.trader?.username || r.trader?.displayName || "anon",
      at: r.createdAt,
    })),
  });
}

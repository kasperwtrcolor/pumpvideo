import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader, serializeCoin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/coins?sort=hot|new|top|clips&limit=24&offset=0&q=dog&graduated=0
 * Browsable coin index — the "Coins" tab.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sort = sp.get("sort") || "hot";
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit")) || 24));
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const q = (sp.get("q") || "").trim();
  const graduatedOnly = sp.get("graduated") === "1";

  const orderBy =
    sort === "new"
      ? { createdAt: "desc" as const }
      : sort === "top"
        ? { marketCapSol: "desc" as const }
        : sort === "clips"
          ? { clips: { _count: "desc" as const } }
          : { marketCapSol: "desc" as const };

  const where = {
    isBanned: false,
    ...(graduatedOnly ? { complete: true } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { symbol: { contains: q } },
            { mint: { contains: q } },
          ],
        }
      : {}),
  };

  const [coins, total] = await Promise.all([
    prisma.coin.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      include: { _count: { select: { clips: { where: { ready: true } } } } },
    }),
    prisma.coin.count({ where }),
  ]);

  return withTrader({
    items: coins.map((c) => ({
      ...serializeCoin(c),
      clipCount: c._count.clips,
      clip: c._count.clips > 0 ? `/clips/${c.mint}.mp4` : null,
    })),
    nextOffset: offset + coins.length,
    total,
  });
}

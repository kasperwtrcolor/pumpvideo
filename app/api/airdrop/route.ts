import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/airdrop?label=<label>
 *
 * The published $pemp allocation. Public and read-only: the whole value of a
 * frozen snapshot is that anyone can look at it — the manifest hash printed here
 * is what a claim contract is checked against, and what settles any later
 * dispute about who was owed what.
 *
 * With no `label`, returns the most recent snapshot. Allocations are paginated
 * by rank; the full list lives in the CSV at /airdrop/<label>.csv.
 */
export async function GET(req: NextRequest) {
  const label = req.nextUrl.searchParams.get("label");
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 100));

  const snapshot = await prisma.airdropSnapshot.findFirst({
    where: label ? { label } : {},
    orderBy: { createdAt: "desc" },
    include: {
      allocations: { orderBy: { rank: "asc" }, take: limit },
    },
  });

  if (!snapshot) {
    return withTrader({ snapshot: null, allocations: [] }, { status: 404 });
  }

  return withTrader({
    snapshot: {
      label: snapshot.label,
      cutoff: snapshot.cutoff,
      criteria: snapshot.criteria,
      manifestHash: snapshot.manifestHash,
      totalWallets: snapshot.totalWallets,
      totalPoints: snapshot.totalPoints,
      tokenPool: snapshot.tokenPool,
      createdAt: snapshot.createdAt,
      /// Where the full, hash-verifiable list lives.
      csv: `/airdrop/${snapshot.label}.csv`,
    },
    allocations: snapshot.allocations.map((a) => ({
      wallet: a.wallet,
      rank: a.rank,
      points: a.points,
      sharePct: a.sharePct,
      tokenAmount: a.tokenAmount,
    })),
  });
}

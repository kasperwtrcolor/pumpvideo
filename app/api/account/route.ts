import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withTrader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { resolveTrader } from "@/lib/session";
import { requireTrader } from "@/lib/auth";
import { normalizeUsername, usernameError } from "@/lib/social";
import { rawTokensToUi } from "@/lib/bonding-curve";
import { SOLANA_RPC } from "@/lib/pumpfun";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  username: z.string().trim().max(30).optional(),
  bio: z.string().trim().max(160).optional(),
});

/**
 * PATCH /api/account — claim a handle, set a bio.
 *
 * Requires a *verified* identity, not just the session cookie. A handle is a
 * scarce public name: if an anonymous cookie could claim one, anyone could take
 * "dave" by curling this endpoint, and there would be no way to give it back.
 *
 * Sending `username: ""` clears the handle, which is a deliberate escape hatch
 * — a name you regret should be removable, not a permanent tattoo.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  let parsed: z.infer<typeof PatchBody>;
  try {
    parsed = PatchBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  const data: { username?: string | null; bio?: string | null } = {};

  if (parsed.username !== undefined) {
    if (parsed.username === "") {
      data.username = null;
    } else {
      const problem = usernameError(parsed.username);
      if (problem) {
        return NextResponse.json({ error: "BAD_USERNAME", detail: problem }, { status: 400 });
      }
      const next = normalizeUsername(parsed.username);
      const taken = await prisma.trader.findUnique({
        where: { username: next },
        select: { id: true },
      });
      if (taken && taken.id !== trader.id) {
        return NextResponse.json(
          { error: "USERNAME_TAKEN", detail: "that handle is already taken" },
          { status: 409 },
        );
      }
      data.username = next;
    }
  }

  if (parsed.bio !== undefined) data.bio = parsed.bio === "" ? null : parsed.bio;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "NOTHING_TO_UPDATE" }, { status: 400 });
  }

  // A unique-key race (two people claiming the same handle at once) surfaces as
  // P2002. Reporting it as "taken" is the honest answer and avoids a 500.
  try {
    const updated = await prisma.trader.update({
      where: { id: trader.id },
      data,
      select: { username: true, bio: true },
    });
    return NextResponse.json({ ok: true, username: updated.username, bio: updated.bio });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "USERNAME_TAKEN", detail: "that handle was just taken" },
        { status: 409 },
      );
    }
    throw e;
  }
}

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

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/clips/[id]/favorite — toggle this trader's save.
 *
 * Login required, for the same reason a like is: a favourite is attached to an
 * identity, and it is the thing that makes the saved list worth having later.
 *
 * Unlike a like there is no denormalised counter to move — a favourite is
 * private, so nothing else needs to agree with it. The unique (clipId, traderId)
 * key makes the toggle idempotent.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true } });
  if (!clip) return NextResponse.json({ error: "NO_CLIP" }, { status: 404 });

  const existing = await prisma.clipFavorite.findUnique({
    where: { clipId_traderId: { clipId: id, traderId: trader.id } },
    select: { id: true },
  });

  if (existing) {
    await prisma.clipFavorite.delete({ where: { id: existing.id } });
  } else {
    await prisma.clipFavorite.create({ data: { clipId: id, traderId: trader.id } });
  }

  const favorites = await prisma.clipFavorite.count({ where: { traderId: trader.id } });

  return NextResponse.json({ ok: true, favorited: !existing, favorites });
}

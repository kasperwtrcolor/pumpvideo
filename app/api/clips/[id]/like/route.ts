import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/clips/[id]/like — toggle this trader's like.
 *
 * Login required. The unique (clipId, traderId) key on ClipLike makes the toggle
 * idempotent, so a double tap can't inflate the count. The denormalised counter
 * on Clip is updated in the same transaction as the row.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true } });
  if (!clip) return NextResponse.json({ error: "NO_CLIP" }, { status: 404 });

  const existing = await prisma.clipLike.findUnique({
    where: { clipId_traderId: { clipId: id, traderId: trader.id } },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.clipLike.delete({ where: { id: existing.id } }),
      prisma.clip.update({ where: { id }, data: { likes: { decrement: 1 } } }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.clipLike.create({ data: { clipId: id, traderId: trader.id } }),
      prisma.clip.update({ where: { id }, data: { likes: { increment: 1 } } }),
    ]);
  }

  const fresh = await prisma.clip.findUnique({ where: { id }, select: { likes: true } });

  return NextResponse.json({
    ok: true,
    liked: !existing,
    // Re-read rather than echo a computed number — the stored count is the truth.
    likes: Math.max(0, fresh?.likes ?? 0),
  });
}

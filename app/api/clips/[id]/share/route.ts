import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/clips/[id]/share — record that this trader shared the clip.
 *
 * Login required, so the number means "people shared this", not "a script hit an
 * endpoint". Unlike a like there is no unique key: sharing the same clip twice
 * is legitimate and counts twice.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true } });
  if (!clip) return NextResponse.json({ error: "NO_CLIP" }, { status: 404 });

  const [, updated] = await prisma.$transaction([
    prisma.clipShare.create({ data: { clipId: id, traderId: trader.id } }),
    prisma.clip.update({ where: { id }, data: { shares: { increment: 1 } } }),
  ]);

  return NextResponse.json({ ok: true, shares: Math.max(0, updated.shares) });
}

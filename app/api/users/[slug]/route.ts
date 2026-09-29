import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readTrader } from "@/lib/session";
import { serializeClip, serializeCoin } from "@/lib/api";
import { USER_CARD_SELECT, toUserCard } from "@/lib/social";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/[slug]
 *
 * A public profile: the account card plus the clips it has published.
 *
 * `slug` is either a claimed username or a raw trader id, so every account is
 * reachable — including one that has never claimed a handle and can therefore
 * only be addressed by id. It is deliberately *not* the `handle` field, which
 * is the session cookie value; publishing that would make any profile link a
 * session-stealing link.
 *
 * Public on purpose. A profile that required a login to view could not be
 * linked to from a clip or shared, which is most of the point of having one.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const clean = decodeURIComponent(slug).replace(/^@/, "").slice(0, 64);

  const trader =
    (await prisma.trader.findUnique({
      where: { username: clean.toLowerCase() },
      select: USER_CARD_SELECT,
    })) ??
    (await prisma.trader.findUnique({
      where: { id: clean },
      select: USER_CARD_SELECT,
    }));

  if (!trader) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const viewer = await readTrader();

  const [clips, clipCount, following, viewerFollows] = await Promise.all([
    prisma.clip.findMany({
      where: { uploadedById: trader.id, ready: true, coin: { isBanned: false } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 24,
      include: { coin: true },
    }),
    prisma.clip.count({ where: { uploadedById: trader.id, ready: true } }),
    prisma.follow.count({ where: { followerId: trader.id } }),
    viewer?.id
      ? prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: viewer.id, followingId: trader.id } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const card = toUserCard(trader, viewer?.id ?? null, Boolean(viewerFollows));

  return NextResponse.json({
    user: { ...card, following: following },
    // The clips grid only needs the thumbnail, the caption and the coin — but
    // the same serializer as the feed is used so a clip that opens from here
    // carries identical fields wherever it is rendered.
    clips: clips.map((c) => ({
      ...serializeClip(c),
      coin: serializeCoin(c.coin),
    })),
    total: clipCount,
  });
}

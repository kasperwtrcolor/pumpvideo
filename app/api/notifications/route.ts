import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { publicName, profileSlug } from "@/lib/social";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications?limit=30
 *
 * The inbox. Login-gated: notifications are per-account, so there is nothing
 * meaningful to return to an anonymous caller.
 *
 * `unread` comes back on every response — including `?limit=0`, which is what
 * the bell badge polls. Asking for zero items must still report the count, or
 * the badge would need a second endpoint that could disagree with this one.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(50, Math.max(0, Number(sp.get("limit") ?? 30)));

  const [unread, rows] = await Promise.all([
    prisma.notification.count({ where: { traderId: trader.id, read: false } }),
    limit === 0
      ? Promise.resolve([])
      : prisma.notification.findMany({
          where: { traderId: trader.id },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: limit,
          include: {
            actor: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
            clip: {
              select: {
                id: true,
                thumbUrl: true,
                videoUrl: true,
                coin: { select: { symbol: true, imageUrl: true } },
              },
            },
          },
        }),
  ]);

  return NextResponse.json({
    unread,
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      read: n.read,
      at: n.createdAt.toISOString(),
      actor: n.actor
        ? {
            slug: profileSlug(n.actor),
            name: publicName(n.actor),
            avatarUrl: n.actor.avatarUrl,
          }
        : null,
      coinSymbol: n.clip?.coin?.symbol ?? null,
      coinImage: n.clip?.coin?.imageUrl ?? null,
      clipId: n.clipId,
      clipThumb: n.clip?.thumbUrl ?? n.clip?.coin?.imageUrl ?? null,
      coinMint: n.coinMint,
    })),
  });
}

const MarkBody = z.object({
  ids: z.array(z.string().min(1).max(64)).max(200).optional(),
  all: z.boolean().optional(),
});

/**
 * POST /api/notifications — mark read.
 *
 * Scoped to the caller's own rows, with the ownership check built into the
 * `where` rather than done first and then trusted: `updateMany` can only touch
 * rows matching `traderId`, so there is no window where an id from another
 * account could be marked.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  let parsed: z.infer<typeof MarkBody>;
  try {
    parsed = MarkBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  const where = parsed.all
    ? { traderId: trader.id, read: false }
    : parsed.ids && parsed.ids.length
      ? { traderId: trader.id, id: { in: parsed.ids } }
      : null;

  if (!where) {
    return NextResponse.json({ error: "NOTHING_TO_MARK" }, { status: 400 });
  }

  const res = await prisma.notification.updateMany({ where, data: { read: true } });
  const unread = await prisma.notification.count({
    where: { traderId: trader.id, read: false },
  });

  return NextResponse.json({ ok: true, marked: res.count, unread });
}

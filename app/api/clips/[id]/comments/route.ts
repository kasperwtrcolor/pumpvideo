import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { publicAuthor } from "@/lib/social";
import { readTrader } from "@/lib/session";
import { clientKey, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const MAX_COMMENT = 280;

const Body = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT),
});

/** Public shape of a comment. Never leaks the author's wallet or email. */
function serialize(
  c: {
    id: string;
    body: string;
    createdAt: Date;
    trader: { username: string | null; displayName: string | null; avatarUrl: string | null };
  },
  meId: string | null,
  authorId: string,
) {
  return {
    id: c.id,
    body: c.body,
    // Never the session handle. A slice of it used to be shown here, which put
    // session-derived material on a public screen.
    author: publicAuthor(c.trader),
    avatarUrl: c.trader.avatarUrl,
    mine: meId !== null && meId === authorId,
    at: c.createdAt,
  };
}

/** GET /api/clips/[id]/comments — public read. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true, comments: true } });
  if (!clip) return NextResponse.json({ error: "NO_CLIP" }, { status: 404 });

  // The cookie identifies the viewer so we can flag their own comments. It is
  // read, never created, here — a read must not mint a session.
  const me = await readTrader().catch(() => null);

  const rows = await prisma.clipComment.findMany({
    where: { clipId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      trader: { select: { username: true, displayName: true, avatarUrl: true } },
    },
  });

  return NextResponse.json(
    {
      count: Math.max(0, clip.comments),
      comments: rows.map((r) => serialize(r, me?.id ?? null, r.traderId)),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/** POST /api/clips/[id]/comments — login required. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const limit = rateLimit(`comment:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", detail: "slow down a moment" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true } });
  if (!clip) return NextResponse.json({ error: "NO_CLIP" }, { status: 404 });

  const [created, updated] = await prisma.$transaction([
    prisma.clipComment.create({
      data: { clipId: id, traderId: trader.id, body: parsed.body },
      include: { trader: { select: { username: true, displayName: true, avatarUrl: true } } },
    }),
    prisma.clip.update({ where: { id }, data: { comments: { increment: 1 } } }),
  ]);

  return NextResponse.json({
    ok: true,
    count: Math.max(0, updated.comments),
    comment: serialize(created, trader.id, created.traderId),
  });
}

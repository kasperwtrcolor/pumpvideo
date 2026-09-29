import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { toggleTokenFollow } from "@/lib/social";

export const dynamic = "force-dynamic";

const Body = z.object({ mint: z.string().min(32).max(48) });

/**
 * POST /api/token-follow — follow or unfollow a token.
 *
 * Addressed by mint rather than coin id because the two callers are the feed
 * (which only knows the mint) and the coin page (which knows the symbol); the
 * mint is the one stable identifier both can produce.
 *
 * Following a token puts every clip bound to it into the Following feed, and
 * notifies you when a new one lands.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const limit = rateLimit(`tokfollow:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  const coin = await prisma.coin.findUnique({
    where: { mint: parsed.mint },
    select: { id: true },
  });
  if (!coin) {
    return NextResponse.json({ error: "UNKNOWN_TOKEN" }, { status: 404 });
  }

  const result = await toggleTokenFollow(trader.id, coin.id);
  if ("error" in result) {
    return NextResponse.json({ error: "CANNOT_FOLLOW", detail: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, following: result.following });
}

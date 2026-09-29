import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTrader } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { toggleFollow } from "@/lib/social";

export const dynamic = "force-dynamic";

const Body = z.object({ traderId: z.string().min(1).max(64) });

/**
 * POST /api/follow — follow or unfollow an account.
 *
 * A toggle rather than separate follow/unfollow routes: the client only ever
 * knows the state it last rendered, and a toggle is idempotent against a
 * double-tap in a way that "POST /follow" is not (that would create the row
 * twice, or 500 on the unique key).
 *
 * Login required. An anonymous cookie could otherwise be used to inflate
 * someone's follower count and to spam their inbox with follow notifications.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  const limit = rateLimit(`follow:${clientKey(req)}`, 60, 60_000);
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

  const result = await toggleFollow(trader.id, parsed.traderId);
  if ("error" in result) {
    return NextResponse.json({ error: "CANNOT_FOLLOW", detail: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, following: result.following });
}

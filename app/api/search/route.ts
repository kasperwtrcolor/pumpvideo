import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readTrader } from "@/lib/session";
import { USER_CARD_SELECT, toUserCard } from "@/lib/social";

export const dynamic = "force-dynamic";

/** A Solana address is base58 and 32–44 chars; that is worth an exact-match attempt. */
function looksLikeAddress(s: string): boolean {
  return s.length >= 32 && s.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

/**
 * Escape LIKE metacharacters before handing a term to `contains`.
 *
 * Prisma's `contains` becomes `LIKE '%' || value || '%'` and does *not* escape
 * the value, so `%` and `_` arrive as wildcards: searching for "%" matched every
 * row in the catalogue, and `_` was unusable as a search term because it matched
 * any single character. Backslash is Postgres's default LIKE escape character,
 * so escaping the three metacharacters makes them literal.
 *
 * Only the `contains` clauses get this. The exact-match lookups (wallet address,
 * mint) compare with `=`, where a backslash would be a literal character and
 * escaping would break the match.
 */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * GET /api/search?q=<term>
 *
 * Finds accounts and tokens in one round trip, which is what a single search
 * box needs — the user does not know in advance whether "@dave" is a person or
 * a coin, and making them pick a tab first is a worse experience than returning
 * both and letting them scan.
 *
 * Read-only and unauthenticated: nothing here is private, and requiring a login
 * to look someone up would make the follow flow impossible to start. The viewer
 * is read (never created) from the cookie so results can be marked
 * already-following; an anonymous visitor simply gets `isFollowing: false`.
 *
 * Query terms are length-capped and the result sets are small and hard-limited,
 * because `contains` cannot use the unique index on `username` and would
 * otherwise let one request scan the whole Trader table.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 1) {
    return NextResponse.json({ users: [], tokens: [] });
  }

  const viewer = await readTrader();

  // A leading @ is how people write a handle; strip it so "@dave" and "dave"
  // are the same search.
  const term = q.replace(/^@/, "");
  const like = likeLiteral(term);

  const [traders, coins] = await Promise.all([
    prisma.trader.findMany({
      where: {
        OR: [
          { username: { contains: like, mode: "insensitive" } },
          { displayName: { contains: like, mode: "insensitive" } },
          ...(looksLikeAddress(q) ? [{ walletAddress: q }] : []),
        ],
        // Only accounts that are actually identifiable. An anonymous viewer has
        // no name at all, so surfacing one would be a result that cannot be
        // rendered or described.
        NOT: { username: null, displayName: null },
      },
      select: USER_CARD_SELECT,
      // Most-followed first, so the obvious match is not buried under a
      // substring match on a less interesting account.
      orderBy: [{ followerCount: "desc" }, { id: "asc" }],
      take: 12,
    }),
    prisma.coin.findMany({
      where: {
        isBanned: false,
        OR: [
          { symbol: { contains: like, mode: "insensitive" } },
          { name: { contains: like, mode: "insensitive" } },
          ...(looksLikeAddress(q) ? [{ mint: q }] : []),
        ],
      },
      orderBy: [{ marketCapSol: "desc" }, { id: "asc" }],
      take: 12,
    }),
  ]);

  // Which of these does the viewer already follow? One query for the batch.
  const follows = viewer?.id
    ? await prisma.follow.findMany({
        where: { followerId: viewer.id, followingId: { in: traders.map((t) => t.id) } },
        select: { followingId: true },
      })
    : [];
  const followingSet = new Set(follows.map((f) => f.followingId));

  const tokenFollows = viewer?.id
    ? await prisma.tokenFollow.findMany({
        where: { traderId: viewer.id, coinId: { in: coins.map((c) => c.id) } },
        select: { coinId: true },
      })
    : [];
  const tokenFollowSet = new Set(tokenFollows.map((f) => f.coinId));

  return NextResponse.json({
    users: traders.map((t) => toUserCard(t, viewer?.id ?? null, followingSet.has(t.id))),
    tokens: coins.map((c) => ({
      mint: c.mint,
      symbol: c.symbol,
      name: c.name,
      imageUrl: c.imageUrl,
      priceSol: c.priceSol,
      marketCapSol: c.marketCapSol,
      change24hPct: c.change24hPct,
      complete: c.complete,
      isFollowing: tokenFollowSet.has(c.id),
    })),
  });
}

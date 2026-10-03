import { prisma } from "./db";

/**
 * Shared rules for the social graph — follows, token follows and notifications.
 *
 * Kept in one place because these invariants are easy to get subtly wrong from
 * a route handler:
 *
 *   1. The denormalised counts on `Trader` and the `Follow` row that justifies
 *      them are always written in the same transaction. A count that drifts
 *      from its rows is a bug that only shows up as a wrong number on a profile
 *      months later, and is then impossible to attribute.
 *   2. A notification is only created on a *transition* (a follow that did not
 *      exist, a clip that was just created). Re-following an already-followed
 *      account must not re-notify — otherwise the toggle is a spam button.
 *   3. `Trader.handle` is the session cookie value. It must never appear in a
 *      URL, a payload or a display name, or the session becomes forgeable by
 *      anyone who reads it off a screen.
 */

/** The one place a profile link is built from. Never returns `handle`. */
export function profileSlug(t: { id: string; username: string | null }): string {
  return t.username ?? t.id;
}

/**
 * What to show a human for this trader.
 *
 * Deliberately three-tiered: a claimed username is the real identity, a
 * Privy display name is the next best thing, and a wallet is a last resort.
 * Falling back to the literal string "anon" rather than a handle keeps the
 * session token out of the UI entirely.
 */
export function publicName(t: {
  username?: string | null;
  displayName?: string | null;
  walletAddress?: string | null;
}): string {
  if (t.username) return `@${t.username}`;
  if (t.displayName) return t.displayName;
  if (t.walletAddress) return `${t.walletAddress.slice(0, 4)}…${t.walletAddress.slice(-4)}`;
  return "anon";
}

/** Lowercase, 3–20 chars, letters/digits/underscore. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

/**
 * A name for authorship — no leading `@`, because every caller adds its own.
 *
 * Used for clip and comment authors. It never falls back to `handle`: an
 * 8-character slice of the session cookie used to be written into public rows,
 * which put session-derived material into the database and onto the screen. A
 * trader with no name is simply "anon" until they claim one.
 */
export function publicAuthor(t: {
  username?: string | null;
  displayName?: string | null;
}): string {
  if (t.username) return t.username;
  if (t.displayName) return t.displayName;
  return "anon";
}

export function usernameError(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < 3) return "at least 3 characters";
  if (u.length > 20) return "at most 20 characters";
  if (!/^[a-z0-9_]+$/.test(u)) return "letters, numbers and underscores only";
  // Reserved so a profile URL can never collide with a real route.
  if (["search", "favorites", "account", "upload", "coins", "api", "u", "legal"].includes(u)) {
    return "that name is reserved";
  }
  return null;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Follow or unfollow, and report which way it went.
 *
 * The `create` is wrapped so a concurrent double-tap cannot produce two rows
 * (the unique key rejects the second) *and* cannot double-increment the count —
 * the increment only happens if the create actually inserted.
 */
export async function toggleFollow(
  followerId: string,
  followingId: string,
): Promise<{ following: boolean } | { error: string }> {
  if (followerId === followingId) return { error: "cannot follow yourself" };

  const target = await prisma.trader.findUnique({
    where: { id: followingId },
    select: { id: true },
  });
  if (!target) return { error: "no such account" };

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction(async (tx: Tx) => {
      // deleteMany, not delete: if a racing request already removed it, this is
      // a no-op rather than a thrown P2025 that would 500 the whole request.
      const gone = await tx.follow.deleteMany({ where: { followerId, followingId } });
      if (gone.count > 0) {
        await tx.trader.update({
          where: { id: followingId },
          data: { followerCount: { decrement: gone.count } },
        });
        await tx.trader.update({
          where: { id: followerId },
          data: { followingCount: { decrement: gone.count } },
        });
      }
    });
    return { following: false };
  }

  await prisma.$transaction(async (tx: Tx) => {
    await tx.follow.create({ data: { followerId, followingId } });
    await tx.trader.update({
      where: { id: followingId },
      data: { followerCount: { increment: 1 } },
    });
    await tx.trader.update({
      where: { id: followerId },
      data: { followingCount: { increment: 1 } },
    });
    await tx.notification.create({
      data: { traderId: followingId, type: "FOLLOW", actorId: followerId },
    });
  });

  return { following: true };
}

/** Follow or unfollow a token. Same idempotence argument as `toggleFollow`. */
export async function toggleTokenFollow(
  traderId: string,
  coinId: string,
): Promise<{ following: boolean } | { error: string }> {
  const coin = await prisma.coin.findUnique({ where: { id: coinId }, select: { id: true } });
  if (!coin) return { error: "no such token" };

  const existing = await prisma.tokenFollow.findUnique({
    where: { traderId_coinId: { traderId, coinId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.tokenFollow.deleteMany({ where: { traderId, coinId } });
    return { following: false };
  }

  await prisma.tokenFollow.create({ data: { traderId, coinId } });
  return { following: true };
}

/** How many unread notifications this trader has. Drives the bell badge. */
export function unreadCount(traderId: string): Promise<number> {
  return prisma.notification.count({ where: { traderId, read: false } });
}

/** Cap on notification fan-out per clip, so one upload cannot write thousands of rows. */
const FANOUT_LIMIT = 500;

/**
 * Tell the right people that a clip just went up.
 *
 * Two audiences, and they are genuinely different:
 *
 *   UPLOAD     — people who follow the *creator*, who care about what this
 *                person posts.
 *   TOKEN_CLIP — people who follow the *coin*, who care about the market and
 *                want every clip that touches it, whoever made it.
 *
 * Both are skipped when the recipient is the uploader (you know what you just
 * posted) and deduplicated, because a coin-follower who also follows the
 * creator should get one notification, not two for the same clip.
 *
 * Failure is swallowed by the caller: a notification is a courtesy, and losing
 * one must never fail the upload that produced it.
 */
export async function notifyClipPublished(clip: {
  id: string;
  coinId: string;
  coinMint: string;
  uploadedById: string | null;
}): Promise<{ uploads: number; tokens: number }> {
  if (!clip.uploadedById) return { uploads: 0, tokens: 0 };

  const [creatorFollowers, coinFollowers] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: clip.uploadedById },
      select: { followerId: true },
      take: FANOUT_LIMIT,
    }),
    prisma.tokenFollow.findMany({
      where: { coinId: clip.coinId },
      select: { traderId: true },
      take: FANOUT_LIMIT,
    }),
  ]);

  const tokenAudience = new Set(
    coinFollowers.map((f) => f.traderId).filter((id) => id !== clip.uploadedById),
  );
  const uploadAudience = creatorFollowers
    .map((f) => f.followerId)
    .filter((id) => id !== clip.uploadedById);

  // One row per person, preferring the more specific "someone you follow posted"
  // over "a coin you follow got a clip" when they qualify for both.
  const uploadSet = new Set(uploadAudience);
  const rows = [
    ...uploadSet,
  ].map((traderId) => ({
    traderId,
    type: "UPLOAD",
    actorId: clip.uploadedById,
    clipId: clip.id,
  }));
  for (const traderId of tokenAudience) {
    if (uploadSet.has(traderId)) continue;
    rows.push({
      traderId,
      type: "TOKEN_CLIP",
      actorId: clip.uploadedById,
      clipId: clip.id,
    });
  }

  if (rows.length === 0) return { uploads: 0, tokens: 0 };

  await prisma.notification.createMany({ data: rows });
  return {
    uploads: uploadSet.size,
    tokens: rows.length - uploadSet.size,
  };
}

/**
 * The card shape every social surface renders: search results, follower lists,
 * profile headers. Built here so the feed, search and profile cannot disagree
 * about what a user looks like.
 */
export type UserCard = {
  id: string;
  slug: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followers: number;
  following: number;
  isFollowing: boolean;
  isMe: boolean;
};

export function toUserCard(
  t: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    walletAddress: string | null;
    bio: string | null;
    followerCount: number;
    followingCount: number;
  },
  viewerId: string | null,
  isFollowing = false,
): UserCard {
  return {
    id: t.id,
    slug: profileSlug(t),
    name: publicName(t),
    username: t.username,
    avatarUrl: t.avatarUrl,
    bio: t.bio,
    followers: t.followerCount,
    following: t.followingCount,
    isFollowing,
    isMe: viewerId === t.id,
  };
}

/** The select shape `toUserCard` needs, so callers don't each invent it. */
export const USER_CARD_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  walletAddress: true,
  bio: true,
  followerCount: true,
  followingCount: true,
} as const;

/**
 * The app's own X account — distinct from the `X` Privy login provider and from
 * the share-to-X intents. Kept here so the handle is never retyped.
 */
export const X_HANDLE = "@pempfun1";
export const X_URL = "https://x.com/pempfun1";

import type { Prisma } from "@prisma/client";

/**
 * Whether a coin may be shown — in one place.
 *
 * A coin is visible unless it is banned upstream (`isBanned`, mirroring
 * pump.fun's own moderation flag) or hidden by our retention sweep (`hiddenAt`,
 * set when it stopped trading — see lib/retention.ts).
 *
 * Both facts must be checked together, and a missed call site fails *silently*:
 * the query still returns rows, they just include tokens the app has decided not
 * to show. That is how a feed quietly fills with dead tokens. So the predicate
 * lives here, and call sites spread `VISIBLE_COIN` instead of each re-typing
 * `isBanned: false` and later forgetting the second condition.
 *
 * Usage, in a Prisma where-clause:
 *
 *   where: { ...VISIBLE_COIN, imageUrl: { not: null } }
 *   where: { coin: { ...VISIBLE_COIN } }
 *
 * For a coin already loaded into memory (a JS-side filter), use
 * `isVisibleCoin` — same rule, so the two can never disagree.
 */
export const VISIBLE_COIN: Prisma.CoinWhereInput = {
  isBanned: false,
  hiddenAt: null,
};

/**
 * Whether a coin may be *served on request* — a direct link, a saved clip, a
 * position.
 *
 * This is `VISIBLE_COIN` minus the retention gate. A coin the retention sweep
 * has hidden is gone from discovery (the feed, the index, search, the landing)
 * but must still resolve for someone who is already attached to it: their saved
 * clip, their position, a link they have open. Hiding exists to keep dead tokens
 * out of the *feed*, not to break the pages of the people who hold them — and a
 * hidden row is never deleted precisely so this keeps working.
 *
 * Bans are different: a banned coin is a moderation decision about the token
 * itself, so it stops serving everywhere, attached or not.
 */
export const SERVABLE_COIN: Prisma.CoinWhereInput = {
  isBanned: false,
};

/**
 * The in-memory form of `VISIBLE_COIN`.
 *
 * Takes the minimum shape rather than a full `Coin`, so it works on a
 * `select`-ed projection or an `include`-ed relation without a cast.
 */
export function isVisibleCoin(coin: {
  isBanned: boolean;
  hiddenAt: Date | null;
}): boolean {
  return !coin.isBanned && coin.hiddenAt === null;
}

/** The in-memory form of `SERVABLE_COIN`: banned is the only disqualifier. */
export function isServableCoin(coin: { isBanned: boolean }): boolean {
  return !coin.isBanned;
}

/**
 * The fields `isVisibleCoin` needs. Spread into a `select` when the query only
 * exists to test visibility, so a whole row is not fetched to answer a boolean.
 */
export const COIN_VISIBILITY_FIELDS = {
  isBanned: true,
  hiddenAt: true,
} as const;

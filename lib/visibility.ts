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

/**
 * The fields `isVisibleCoin` needs. Spread into a `select` when the query only
 * exists to test visibility, so a whole row is not fetched to answer a boolean.
 */
export const COIN_VISIBILITY_FIELDS = {
  isBanned: true,
  hiddenAt: true,
} as const;

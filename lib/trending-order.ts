/**
 * Trending's display order — a fresh permutation every hour.
 *
 * Trending is the one rail whose *membership* comes from outside us: the
 * Dexscreener board names the coins (lib/ingest.ts stamps `trendingAt`), and the
 * board carries its own order, which is essentially "whoever paid the most to
 * boost". Ranked that way the rail reads as an advertisement, top to bottom,
 * and the same handful of boosted tokens sit in the same slots all day.
 *
 * So the stored order is thrown away and the set is permuted instead. The seed
 * is the *hour bucket* — `floor(now / 1h)` — not the visitor's session seed,
 * which buys three things a per-visitor shuffle cannot:
 *
 *   1. Everyone sees the same order in the same hour. "Trending" is a claim
 *      about the market, and two people comparing screens should not be looking
 *      at two different orders.
 *   2. Pagination holds. The feed pages by offset, so page 2 must re-derive the
 *      exact permutation page 1 used; a seed that changes per request would
 *      repeat clips and drop others (see lib/shuffle.ts). Within the hour the
 *      seed is a constant, so the permutation is too.
 *   3. It rotates on a clock, not on a visit. A visitor who leaves the tab open
 *      gets a genuinely new order when the hour turns — which is the whole
 *      point of asking for an hourly refresh.
 *
 * The hour bucket is UTC-anchored (epoch hours) so it is identical on every
 * server instance; a local-time boundary would shuffle at different instants
 * for different callers.
 */

/** How long one Trending permutation stands, in ms. */
export const TRENDING_ROTATE_MS = 60 * 60_000;

/**
 * The shuffle seed for the current hour. Pass `now` to derive it for a specific
 * instant (tests); callers in request paths use the default.
 */
export function trendingSeed(now: number = Date.now()): string {
  return `tr-h${Math.floor(now / TRENDING_ROTATE_MS)}`;
}

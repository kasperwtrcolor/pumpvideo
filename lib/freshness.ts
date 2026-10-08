/**
 * How stale a coin's market measurement may be and still be trusted to *rank* on.
 *
 * The keeper only writes `lastSyncedAt` when a coin is successfully re-measured
 * (a Dexscreener pair for a graduated coin, a pump.fun ranked hit for an
 * on-curve one). When a coin's source stops answering — its pool is drained or
 * delisted, or it falls out of every ranking — the coin can no longer be
 * re-measured, so its last price and market cap are **frozen forever**.
 *
 * That freeze is invisible on its own, but it is not harmless: the market-cap
 * rails rank purely on the stored number, so a dead coin that topped out at a
 * huge cap keeps sitting at the top of Top. This is exactly how a token trading
 * at ~$2.5k was shown at $377M, weeks after its pool disappeared.
 *
 * So a rank is only trustworthy if the number behind it was measured recently.
 * A live coin is re-measured every keeper tick (hourly); six hours is six
 * consecutive misses, which is long enough to ride out a keeper or source
 * outage without ever letting a genuinely dead coin back onto the board.
 *
 * Deliberately NOT the retention sweep's job. Retention hides *dead* coins, but
 * a coin a user has clipped is protected from it — and rightly so, their clip
 * wall must keep working. This gate is orthogonal: it does not hide anything, it
 * simply refuses to *rank* on a number we cannot stand behind. The coin's page
 * still renders; it just stops winning a leaderboard it no longer qualifies for.
 */
export const MC_FRESH_MS = 6 * 60 * 60_000;

/** The timestamp before which a measurement is too stale to rank on. */
export function mcFreshCutoff(now: number = Date.now()): Date {
  return new Date(now - MC_FRESH_MS);
}

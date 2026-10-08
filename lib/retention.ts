import { prisma } from "./db";
import { MIN_MCAP_SOL } from "./ingest";
import { fetchCoinsByMints, toCoinRecord } from "./pumpfun";
import { fetchDexQuotes } from "./dexscreener";
import { fetchJupPrices } from "./jup-price";
import { MIN_HOLDERS } from "./holders";

/**
 * Dead-token retention: take tokens that stopped trading out of the catalogue.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID
 *
 * The obvious implementation — "volume24hSol = 0 for N days, hide it" — would
 * have hidden almost the entire catalogue, including live tokens. Stored volume
 * is only fresh for the handful of coins the keeper samples each tick (it walks
 * the top `limit` by market cap). At the time of writing, 59 of 2,375 coins had
 * been synced in the last 30 minutes. So for the other ~2,300, `volume24hSol`
 * is not "measured zero", it is "never measured" — and treating the two as the
 * same thing deletes a live token because nobody looked at it.
 *
 * So this module never trusts stored market state to decide death. It *measures*
 * first, via the same pump.fun sweep the keeper uses, and only acts on what the
 * sweep actually reported. The cheap stored-data filters are used solely to
 * narrow the candidate set — never as the verdict.
 *
 * WHAT "DEAD" MEANS HERE
 *
 * A candidate is dead if the sweep either:
 *   - did not return it at all: it has fallen out of both the top-1000 by
 *     market cap and the newest-1000. For a coin older than the grace period
 *     that is genuine, and it is the signal the ingest floor cannot give us; or
 *   - returned it still on the curve with a market cap below the same
 *     MIN_MCAP_SOL floor ingest uses to admit a token in the first place.
 *
 * Anything complete (graduated) or above the floor is alive and left alone,
 * however little we think of it.
 *
 * REFUSING TO ACT ON A PARTIAL VIEW
 *
 * A rate-limited pump.fun page yields a sweep that found *nothing*, which is
 * indistinguishable from "everything fell out of the rankings". Acting on that
 * would hide live coins in bulk. So if the sweep reports any page failure, this
 * module plans but does not apply, and says so. A wrong hiding is worse than a
 * late one: the user sees a working token disappear with no explanation.
 */

/** Default grace period. A token gets three days to prove it is worth keeping. */
export const DEFAULT_GRACE_DAYS = 3;

/** How many candidates one pass may consider, so a run stays bounded. */
export const DEFAULT_LIMIT = 2000;

/** `hide` is reversible and is the default. `delete` reclaims disk and is not. */
export type RetentionMode = "hide" | "delete";

/**
 * How long a coin gets to find holders before the dust gate may hide it.
 *
 * One hour, not zero. Almost every launch has <30 holders in its first minutes
 * (measured: 92% of fresh launches, median 3), so a gate that fired on arrival
 * would hide the entire New rail and would never surface a coin that starts tiny
 * and grows. An hour is long enough for a real launch to accumulate a holder
 * base and short enough that dust does not linger.
 */
export const DUST_MIN_AGE_MS = 60 * 60_000;

/**
 * How stale a holder count may be and still be trusted for the dust gate.
 *
 * The keeper refreshes holders round-robin (50/tick, ~600/hour), so a given
 * coin's count is refreshed roughly every few hours. Acting on anything older
 * risks hiding a coin on a stale-low reading — the same "measured vs never
 * measured" trap this module exists to avoid.
 */
export const HOLDER_FRESH_MS = 12 * 60 * 60_000;

export type RetentionCandidate = {
  id: string;
  mint: string;
  symbol: string;
  createdAt: Date;
};

export type RetentionPlan = {
  graceDays: number;
  cutoff: Date;
  /** Rows that passed the cheap filters and were then put to the live sweep. */
  candidates: RetentionCandidate[];
  /** The sweep proved these are gone. */
  dead: RetentionCandidate[];
  /**
   * Coins that must never be *deleted*: a user uploaded a clip for one, holds a
   * position in it, follows it, or has traded it.
   *
   * This set governs deletion only. Hiding ignores it — a dead token leaves the
   * feed whoever is attached to it, because a follow is not a reason to keep
   * showing everyone else a token that no longer trades.
   */
  guarded: Set<string>;
  /** The sweep proved these are still alive — left alone. */
  alive: RetentionCandidate[];
  /** Fell out of both rankings, i.e. no longer refreshable through the API. */
  unranked: RetentionCandidate[];
  /** Rows removed before the sweep, by each dependency guard. */
  skipped: {
    userClip: number;
    position: number;
    followed: number;
    traded: number;
  };
  /** Per-page sweep failures. Non-empty means we must NOT act. */
  sweepErrors: string[];
  /** True when the plan is safe to apply. */
  actionable: boolean;
};

/**
 * Cheap pre-filter: old, not already hidden, not banned upstream, and with no
 * stored 24h volume.
 *
 * `guarded` is the set of these candidates a user is attached to — they uploaded
 * a clip for it, hold a position in it, or follow it. The guards are NOT applied
 * here: an attached coin is still hidden from the feed when it dies (the user
 * said so — a follow must not keep a dead token in front of everyone else), it is
 * only spared *deletion*, so the attachment survives. See `applyRetention`.
 */
async function selectCandidates(
  graceDays: number,
  limit: number,
): Promise<{ rows: RetentionCandidate[]; traded: Set<string>; guarded: Set<string> }> {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000);

  const rows = await prisma.coin.findMany({
    where: {
      createdAt: { lt: cutoff },
      hiddenAt: null,
      isBanned: false,
      // Directionally safe even though stored volume is stale: a non-zero
      // reading means it *did* trade, so it can only shrink the candidate set.
      volume24hSol: { lte: 0 },
    },
    select: { id: true, mint: true, symbol: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const ids = rows.map((r) => r.id);
  const mints = rows.map((r) => r.mint);

  // Trade has no foreign key to Coin — `coinMint` is a plain string on purpose,
  // so trade history and the creator-rewards ledger outlive catalogue pruning.
  // That also means the guard cannot be expressed as a Prisma relation and has
  // to be a separate lookup.
  const [tradedHits, guardedRows] = await Promise.all([
    mints.length
      ? prisma.trade.findMany({
          where: { coinMint: { in: mints } },
          select: { coinMint: true },
          distinct: ["coinMint"],
        })
      : Promise.resolve([]),
    ids.length
      ? prisma.coin.findMany({
          where: {
            id: { in: ids },
            OR: [
              { clips: { some: { uploadedById: { not: null } } } },
              { positions: { some: {} } },
              { followers: { some: {} } },
            ],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    rows,
    traded: new Set(tradedHits.map((t) => t.coinMint)),
    guarded: new Set(guardedRows.map((g) => g.id)),
  };
}

/** Count how many rows each guard spares from *deletion*, for the dry-run report. */
async function countSkipped(graceDays: number): Promise<RetentionPlan["skipped"]> {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000);
  const base = {
    createdAt: { lt: cutoff },
    hiddenAt: null,
    isBanned: false,
    volume24hSol: { lte: 0 },
  };

  const [userClip, position, followed] = await Promise.all([
    prisma.coin.count({
      where: { ...base, clips: { some: { uploadedById: { not: null } } } },
    }),
    prisma.coin.count({ where: { ...base, positions: { some: {} } } }),
    prisma.coin.count({ where: { ...base, followers: { some: {} } } }),
  ]);

  // Trades again need the mint list, so this one has to walk the same rows.
  const withTrades = await prisma.coin.findMany({
    where: base,
    select: { mint: true },
  });
  const mints = withTrades.map((c) => c.mint);
  const traded =
    mints.length > 0
      ? await prisma.trade.findMany({
          where: { coinMint: { in: mints } },
          select: { coinMint: true },
          distinct: ["coinMint"],
        })
      : [];

  return { userClip, position, followed, traded: traded.length };
}

/**
 * Build the plan without changing anything.
 *
 * Split from `applyRetention` so the dry run and the real run make the identical
 * decision — a preview that reasoned differently from the thing it previews is
 * worse than no preview.
 */
export async function planRetention(opts: {
  graceDays?: number;
  limit?: number;
} = {}): Promise<RetentionPlan> {
  const graceDays = opts.graceDays ?? DEFAULT_GRACE_DAYS;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(Date.now() - graceDays * 86_400_000);

  const [skipped, { rows, traded, guarded }] = await Promise.all([
    countSkipped(graceDays),
    selectCandidates(graceDays, limit),
  ]);

  // Nothing is filtered out of the candidate set for hiding: an attached coin
  // still leaves the feed when it dies. It is protected only from *deletion*, so
  // the trade-history guard is merged into the same set the delete path consults.
  const protectedIds = new Set(guarded);
  for (const r of rows) if (traded.has(r.mint)) protectedIds.add(r.id);
  const candidates = rows;

  if (candidates.length === 0) {
    return {
      graceDays,
      cutoff,
      candidates,
      dead: [],
      alive: [],
      unranked: [],
      guarded: protectedIds,
      skipped,
      sweepErrors: [],
      actionable: true,
    };
  }

  const sweepErrors: string[] = [];
  const found = await fetchCoinsByMints(
    candidates.map((c) => c.mint),
    { errors: sweepErrors },
  );

  const dead: RetentionCandidate[] = [];
  const alive: RetentionCandidate[] = [];
  const unranked: RetentionCandidate[] = [];

  for (const c of candidates) {
    const hit = found.get(c.mint);
    if (!hit) {
      // Absent from both rankings. See the module comment: for a coin past the
      // grace period this *is* the verdict, and it is why the sweep must be
      // complete before we trust it.
      unranked.push(c);
      dead.push(c);
      continue;
    }
    const rec = toCoinRecord(hit);
    if (rec.complete || rec.marketCapSol >= MIN_MCAP_SOL) {
      alive.push(c);
    } else {
      dead.push(c);
    }
  }

  // Rescue step, and the reason this module still works now that prices come from
  // three sources rather than one.
  //
  // The pump.fun ranking is a *discovery* list, not a liveness oracle. A
  // graduated coin leaves it permanently the moment it graduates, and an
  // on-curve coin falls off it within hours — so "unranked" was never the same
  // as "stopped trading", it only looked like it while the ranking was the only
  // thing we could read. Jupiter quotes both by mint (see lib/jup-price.ts), so
  // a candidate that still has a quote is alive by the only test that matters
  // here: someone can still trade it. Without this the sweep would hide, and on
  // a `--hard` run delete, coins that have a live market — the opposite of what
  // a catalogue of tradeable tokens wants.
  const jup = dead.length
    ? await fetchJupPrices(dead.map((d) => d.mint)).catch(() => new Map())
    : new Map();
  const stillDead: RetentionCandidate[] = [];
  for (const c of dead) {
    if (jup.has(c.mint)) {
      alive.push(c);
      const i = unranked.indexOf(c);
      if (i >= 0) unranked.splice(i, 1);
    } else {
      stillDead.push(c);
    }
  }

  return {
    graceDays,
    cutoff,
    candidates,
    dead: stillDead,
    alive,
    unranked,
    guarded: protectedIds,
    skipped,
    sweepErrors,
    actionable: sweepErrors.length === 0,
  };
}

export type RetentionResult = {
  mode: RetentionMode;
  planned: number;
  applied: number;
  /** Dead coins a user is attached to, so *delete* left them hidden instead. */
  spared: number;
  /** Set when the plan was not actionable; the reason, for the log. */
  refused: string | null;
};

/**
 * Apply a plan.
 *
 * `hide` stamps `hiddenAt`, which every read path filters on via VISIBLE_COIN,
 * and which `restoreRevived` can clear if the token ever trades again.
 *
 * `delete` removes the rows for good and cascades to their ingest-created clips,
 * price points and follows. Only reachable for coins no user is attached to,
 * because those never became candidates.
 */
export async function applyRetention(
  plan: RetentionPlan,
  mode: RetentionMode = "hide",
): Promise<RetentionResult> {
  if (!plan.actionable) {
    return {
      mode,
      planned: plan.dead.length,
      applied: 0,
      spared: 0,
      refused:
        `incomplete pump.fun sweep (${plan.sweepErrors.length} page failure(s)); ` +
        `a partial view cannot tell dead from unranked`,
    };
  }
  if (plan.dead.length === 0) {
    return { mode, planned: 0, applied: 0, spared: 0, refused: null };
  }

  // Deletion is the only irreversible step, so it is the only one the guards
  // apply to. A hidden row keeps the user's clip, position and follow intact —
  // which is exactly what "hidden, not deleted" means. A coin a user is attached
  // to is therefore removed from the feed like any other, but survives as a row.
  const target =
    mode === "delete" ? plan.dead.filter((c) => !plan.guarded.has(c.id)) : plan.dead;
  const spared = plan.dead.length - target.length;
  if (target.length === 0) {
    return { mode, planned: plan.dead.length, applied: 0, spared, refused: null };
  }

  const ids = target.map((c) => c.id);

  const res =
    mode === "delete"
      ? await prisma.coin.deleteMany({ where: { id: { in: ids } } })
      : await prisma.coin.updateMany({
          where: { id: { in: ids } },
          data: { hiddenAt: new Date() },
        });

  return { mode, planned: plan.dead.length, applied: res.count, spared, refused: null };
}

/**
 * Dust gate — hide coins that are old enough to know better and still have
 * almost no holders.
 *
 * This is the cheap half of retention. `planRetention` above costs a live
 * pump.fun sweep because it must tell "dead" from "nobody looked at it"; this
 * costs one database read, because a holder count is already the verdict. It
 * runs every keeper tick (see lib/keeper.ts) and never touches the network.
 *
 * WHY HOLDERS AND NOT MARKET CAP
 *
 * The ingest floor (MIN_MCAP_SOL) admits anything with a few SOL of apparent
 * liquidity, and on pump.fun that is trivially manufactured — a dev can seed a
 * curve alone. Holders are the thing a dev cannot fake for free. Measured on
 * 2026-10-03: 91% of the catalogue sat below 30 holders, median 2, while real
 * coins ran to the hundreds. That gap is the whole gate.
 *
 * THE GUARD
 *
 *   - holders > 0 AND a fresh `holdersSyncedAt`. A stored 0 means "never
 *     measured", not "no holders" — hiding on it would take out every coin the
 *     keeper has not walked yet. A stale count risks the same on a coin that has
 *     since grown.
 *
 * No dependency guards. Hiding is reversible, so a dust coin leaves the feed
 * whether or not a user is attached to it; the attachment protects it from
 * *deletion* only (see `applyRetention`).
 *
 * Reversible by construction: `restoreRevived` un-hides a coin the moment a
 * source can quote it a price again.
 */
export async function hideDust(
  opts: { limit?: number; apply?: boolean } = {},
): Promise<{ candidates: number; hidden: number }> {
  const apply = opts.apply !== false;
  const now = Date.now();
  const rows = await prisma.coin.findMany({
    where: {
      hiddenAt: null,
      isBanned: false,
      // Never a graduated coin: those have real pools and hundreds of holders,
      // so anything flagged complete that reads <30 is bad data, not dust.
      complete: false,
      createdAt: { lt: new Date(now - DUST_MIN_AGE_MS) },
      holders: { gt: 0, lt: MIN_HOLDERS },
      holdersSyncedAt: { gte: new Date(now - HOLDER_FRESH_MS) },
    },
    select: { id: true, mint: true },
    orderBy: { holdersSyncedAt: "asc" },
    take: opts.limit ?? DEFAULT_LIMIT,
  });
  if (rows.length === 0) return { candidates: 0, hidden: 0 };

  // No dependency guards here, on purpose. Hiding is reversible (see
  // `restoreRevived`), so a dust coin is hidden whether or not a user is attached
  // to it — the attachment protects it from *deletion* (see `applyRetention`),
  // not from leaving the feed. Same rule as lib/keeper.ts's dead-market gate.
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { candidates: rows.length, hidden: 0 };
  if (!apply) return { candidates: rows.length, hidden: 0 };

  const res = await prisma.coin.updateMany({
    where: { id: { in: ids } },
    data: { hiddenAt: new Date() },
  });
  return { candidates: rows.length, hidden: res.count };
}

/**
 * How long the keeper may go without re-measuring a coin before its market is
 * treated as gone.
 *
 * The keeper writes `lastSyncedAt` only on a *successful* measurement, so a coin
 * can only be this stale if every source has stopped answering for it — its pool
 * was drained, its pair delisted, or it fell out of every ranking. Three days is
 * deliberately far longer than the gate that only governs *ranking*
 * (lib/freshness.ts, six hours): that gate merely declines to rank on a number
 * we cannot stand behind, while this hides the row outright and so wants much
 * more evidence.
 *
 * This is the missing half of the retention story. `planRetention` refuses to
 * touch a graduated coin whose pump.fun ranking has gone (it cannot tell a dead
 * one from an unranked live one), and it never even looks at a coin whose stored
 * volume is non-zero — so a graduated coin that died after a burst of trading
 * kept a frozen volume that sheltered it from every sweep, forever.
 */
export const DEAD_MARKET_MS = 3 * 86_400_000;

/**
 * A coin measured within this window means the keeper is alive and working.
 *
 * Must comfortably exceed the keeper's cadence or the guard inverts: with the
 * keeper on an hourly cron, a 15-minute window would find ~nothing measured and
 * conclude "the keeper is down" on *every* run, permanently refusing to hide
 * dead markets. Two hours is two full missed ticks — long enough that a healthy
 * keeper always clears it, short enough to catch a genuinely dead cron.
 */
const KEEPER_LIVENESS_MS = 2 * 60 * 60_000;

/** How many coins must be that fresh before we trust staleness as a verdict. */
const KEEPER_LIVENESS_MIN = 10;

export type DeadMarketResult = {
  candidates: number;
  hidden: number;
  /** Set when the guard refused; the reason, for the log. */
  refused: string | null;
};

/**
 * Hide coins whose market has been unmeasurable for days.
 *
 * Reversible (`hiddenAt`, which VISIBLE_COIN filters on, and which the daily
 * retention run's `restoreRevived` clears the moment a token is measurable
 * again), with no dependency guard — a hidden row keeps the user's clip, position
 * and follow intact, so reviving it costs nothing and the guards belong on
 * deletion alone. Refused outright when the keeper itself looks down.
 */
export async function hideDeadMarkets(
  opts: { limit?: number; apply?: boolean } = {},
): Promise<DeadMarketResult> {
  const apply = opts.apply !== false;
  const now = Date.now();

  // Liveness guard. "The keeper has not managed to measure this coin" is only a
  // verdict about the *coin* while the keeper is working. A dead cron or a
  // Dexscreener outage makes every coin look stale at once, and acting on that
  // would hide the entire catalogue in a single pass — so refuse unless a real
  // number of coins have been measured very recently.
  const recentlyMeasured = await prisma.coin.count({
    where: {
      hiddenAt: null,
      isBanned: false,
      lastSyncedAt: { gte: new Date(now - KEEPER_LIVENESS_MS) },
    },
  });
  if (recentlyMeasured < KEEPER_LIVENESS_MIN) {
    return {
      candidates: 0,
      hidden: 0,
      refused: `keeper looks down — only ${recentlyMeasured} coin(s) measured in the last ${
        KEEPER_LIVENESS_MS / 60_000
      }m`,
    };
  }

  const rows = await prisma.coin.findMany({
    where: {
      hiddenAt: null,
      isBanned: false,
      lastSyncedAt: { lt: new Date(now - DEAD_MARKET_MS) },
    },
    select: { id: true, mint: true },
    orderBy: { lastSyncedAt: "asc" },
    take: opts.limit ?? DEFAULT_LIMIT,
  });
  if (rows.length === 0) return { candidates: 0, hidden: 0, refused: null };

  // Same rule as the dust gate: hiding is reversible, so a coin unmeasurable for
  // days leaves the feed whether or not a user is attached to it. The attachment
  // protects it from deletion, not from hiding. (With Jupiter now pricing the
  // on-curve half — see lib/jup-price.ts — a coin only reaches this gate when no
  // source can quote it at all, which is a genuine dead market rather than a
  // coin the keeper merely failed to look at.)
  const ids = rows.map((r) => r.id);
  if (!apply || ids.length === 0) return { candidates: ids.length, hidden: 0, refused: null };

  const res = await prisma.coin.updateMany({
    where: { id: { in: ids } },
    data: { hiddenAt: new Date() },
  });
  return { candidates: ids.length, hidden: res.count, refused: null };
}

/**
 * Un-hide coins that came back to life.
 *
 * Hiding has to be reversible or it is just a slow delete with extra steps: a
 * token can regain a pool, or the sweep can be too eager on a quiet day. Same
 * measurement as the hiding path, opposite direction, and it refuses on a
 * partial sweep for the same reason.
 */
export async function restoreRevived(opts: { limit?: number } = {}): Promise<{
  checked: number;
  restored: number;
  sweepErrors: string[];
}> {
  const hidden = await prisma.coin.findMany({
    where: { hiddenAt: { not: null } },
    select: { id: true, mint: true, complete: true },
    take: opts.limit ?? DEFAULT_LIMIT,
  });
  if (hidden.length === 0) return { checked: 0, restored: 0, sweepErrors: [] };

  const sweepErrors: string[] = [];
  const found = await fetchCoinsByMints(
    hidden.map((c) => c.mint),
    { errors: sweepErrors },
  );

  // Jupiter again — the recovery signal for the *on-curve* half and for any
  // graduated coin that has left the pump.fun rankings (which is every graduated
  // coin, permanently). See lib/jup-price.ts.
  const jupFound =
    hidden.length > 0
      ? await fetchJupPrices(hidden.map((c) => c.mint)).catch(() => new Map())
      : new Map();

  // Dexscreener, for graduated coins only: an on-curve coin answering here is a
  // pool it has not actually moved to yet, and reviving on that would fight the
  // curve-side sweep.
  const gradedMints = hidden.filter((h) => h.complete).map((h) => h.mint);
  const dexFound = gradedMints.length
    ? await fetchDexQuotes(gradedMints, { batchSize: 10 }).catch(() => new Map())
    : new Map();

  // A coin is revived when a source can quote it a price again — which is the
  // exact inverse of why it was hidden. The holder count used to be the recovery
  // signal, but a holder count is not a price: a coin can have holders and no
  // route anywhere, and reviving on that would put a frozen number back on a buy
  // screen. So it is out, and price availability is in. This makes "shown implies
  // priceable" an invariant rather than a hope.
  const revived = hidden.filter((h) => {
    // The sweep only counts when it was complete: a partial sweep cannot tell a
    // dead coin from one nobody managed to look at.
    if (sweepErrors.length === 0) {
      const hit = found.get(h.mint);
      if (hit) {
        const rec = toCoinRecord(hit);
        if (rec.complete || rec.marketCapSol >= MIN_MCAP_SOL) return true;
      }
    }
    if (h.complete && dexFound.has(h.mint)) return true;
    if (jupFound.has(h.mint)) return true;
    return false;
  });

  if (revived.length) {
    await prisma.coin.updateMany({
      where: { id: { in: revived.map((r) => r.id) } },
      data: { hiddenAt: null },
    });
  }

  return {
    checked: hidden.length,
    restored: revived.length,
    sweepErrors,
  };
}

/** Plan, apply, then give anything that recovered its visibility back. */
export async function runRetention(opts: {
  graceDays?: number;
  limit?: number;
  mode?: RetentionMode;
} = {}) {
  const plan = await planRetention(opts);
  const result = await applyRetention(plan, opts.mode ?? "hide");
  const revived = await restoreRevived({ limit: opts.limit });
  return { plan, result, revived };
}

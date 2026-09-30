import { prisma } from "./db";
import { MIN_MCAP_SOL } from "./ingest";
import { fetchCoinsByMints, toCoinRecord } from "./pumpfun";

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

/** Default grace period. A token gets a week to prove it is worth keeping. */
export const DEFAULT_GRACE_DAYS = 7;

/** How many candidates one pass may consider, so a run stays bounded. */
export const DEFAULT_LIMIT = 2000;

/** `hide` is reversible and is the default. `delete` reclaims disk and is not. */
export type RetentionMode = "hide" | "delete";

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
 * Cheap pre-filter: old, not already hidden, not banned upstream, and nothing a
 * user depends on.
 *
 * The dependency guards are the point of the whole exercise. Deleting a Coin
 * cascades (Clip, Position, TokenFollow, PricePoint are all onDelete: Cascade),
 * so a token a user uploaded a clip for, holds a position in, or follows is
 * never a candidate — their content must not be the thing that disappears.
 */
async function selectCandidates(
  graceDays: number,
  limit: number,
): Promise<{ rows: RetentionCandidate[]; traded: Set<string> }> {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000);

  const rows = await prisma.coin.findMany({
    where: {
      createdAt: { lt: cutoff },
      hiddenAt: null,
      isBanned: false,
      // Directionally safe even though stored volume is stale: a non-zero
      // reading means it *did* trade, so it can only shrink the candidate set.
      volume24hSol: { lte: 0 },
      // A clip somebody uploaded by hand. The overwhelming majority of clips
      // are ingest-created art cards; this excludes precisely the ones a human
      // is attached to.
      clips: { none: { uploadedById: { not: null } } },
      positions: { none: {} },
      followers: { none: {} },
    },
    select: { id: true, mint: true, symbol: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  // Trade has no foreign key to Coin — `coinMint` is a plain string on purpose,
  // so trade history and the creator-rewards ledger outlive catalogue pruning.
  // That also means the guard cannot be expressed as a Prisma relation and has
  // to be a separate lookup.
  const mints = rows.map((r) => r.mint);
  const traded = new Set<string>();
  if (mints.length) {
    const hits = await prisma.trade.findMany({
      where: { coinMint: { in: mints } },
      select: { coinMint: true },
      distinct: ["coinMint"],
    });
    for (const h of hits) traded.add(h.coinMint);
  }

  return { rows, traded };
}

/** Count how many rows each guard removed, for the dry-run report. */
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

  const [skipped, { rows, traded }] = await Promise.all([
    countSkipped(graceDays),
    selectCandidates(graceDays, limit),
  ]);

  // Drop anything with a trade history before spending a sweep on it.
  const candidates = rows.filter((r) => !traded.has(r.mint));

  if (candidates.length === 0) {
    return {
      graceDays,
      cutoff,
      candidates,
      dead: [],
      alive: [],
      unranked: [],
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

  return {
    graceDays,
    cutoff,
    candidates,
    dead,
    alive,
    unranked,
    skipped,
    sweepErrors,
    actionable: sweepErrors.length === 0,
  };
}

export type RetentionResult = {
  mode: RetentionMode;
  planned: number;
  applied: number;
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
      refused:
        `incomplete pump.fun sweep (${plan.sweepErrors.length} page failure(s)); ` +
        `a partial view cannot tell dead from unranked`,
    };
  }
  if (plan.dead.length === 0) {
    return { mode, planned: 0, applied: 0, refused: null };
  }

  const ids = plan.dead.map((c) => c.id);

  const res =
    mode === "delete"
      ? await prisma.coin.deleteMany({ where: { id: { in: ids } } })
      : await prisma.coin.updateMany({
          where: { id: { in: ids } },
          data: { hiddenAt: new Date() },
        });

  return { mode, planned: plan.dead.length, applied: res.count, refused: null };
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
    select: { id: true, mint: true },
    take: opts.limit ?? DEFAULT_LIMIT,
  });
  if (hidden.length === 0) return { checked: 0, restored: 0, sweepErrors: [] };

  const sweepErrors: string[] = [];
  const found = await fetchCoinsByMints(
    hidden.map((c) => c.mint),
    { errors: sweepErrors },
  );
  if (sweepErrors.length) {
    return { checked: hidden.length, restored: 0, sweepErrors };
  }

  const revived = hidden.filter((h) => {
    const hit = found.get(h.mint);
    if (!hit) return false;
    const rec = toCoinRecord(hit);
    return rec.complete || rec.marketCapSol >= MIN_MCAP_SOL;
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

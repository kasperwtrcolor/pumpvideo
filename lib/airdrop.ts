/**
 * $pemp airdrop — the pure part: rules, split, and the hash that settles it.
 *
 * Kept free of Prisma and of any clock so the exact function that produces the
 * published allocation is the one that can be re-run to verify it. Nothing here
 * reads the database; the script feeds it wallet stats and gets a frozen list
 * back. That separation is the point — a verifier with the CSV and this file can
 * reproduce the hash without our database.
 *
 * The split reuses `pointsFor` (lib/points.ts), the app's own public score, so
 * what the airdrop pays is a number a user can already see on /top. A reward is
 * only fair if it was predictable.
 */

import { createHash } from "node:crypto";
import { POINT_WEIGHTS, pointsFor } from "./points";
import type { PointStats } from "./points";

/** One wallet's accrual, as of the snapshot cutoff. */
export type WalletStat = {
  wallet: string;
  traderId: string | null;
  stats: PointStats;
};

/**
 * The published rules. Stored verbatim on every AirdropSnapshot so a later
 * change to the weights in code cannot silently rewrite terms already promised.
 * `minPoints` is the sybil floor: a bare wallet connect is 0 points, so nothing
 * that only "stopped by" clears it.
 */
export const DEFAULT_CRITERIA = {
  minPoints: 50,
  walletRequired: true,
  weights: POINT_WEIGHTS,
  note:
    "Allocation = Pemp Points accrued before the cutoff, using the public " +
    "weights in lib/points.ts (the same score shown on /top). A connected " +
    "Solana wallet is required to receive an allocation; wallets below the " +
    "minimum are excluded.",
} as const;

export type Allocation = {
  wallet: string;
  traderId: string | null;
  points: number;
  /** Fraction of the pool, 0..1. */
  sharePct: number;
  /** Absolute $pemp if the pool was known at freeze time, else null. */
  tokenAmount: number | null;
  /** 1-based rank by points. */
  rank: number;
};

/**
 * Turn per-wallet stats into the frozen allocation.
 *
 * Deterministic on purpose: points descending, ties broken by wallet ascending,
 * so re-running against the same inputs reproduces the same order — and therefore
 * the same manifest hash. A ranking that could wobble between runs would make the
 * published hash unverifiable.
 */
export function buildAllocations(
  entries: WalletStat[],
  opts: { minPoints: number; pool?: number | null },
): { allocations: Allocation[]; totalPoints: number; eligible: number; excluded: number } {
  const scored = entries
    .map((e) => ({ ...e, points: pointsFor(e.stats).total }))
    .filter((e) => e.points >= opts.minPoints);

  scored.sort((a, b) => b.points - a.points || a.wallet.localeCompare(b.wallet));

  const totalPoints = scored.reduce((s, e) => s + e.points, 0);
  const pool = opts.pool ?? null;

  const allocations: Allocation[] = scored.map((e, i) => ({
    wallet: e.wallet.toLowerCase(),
    traderId: e.traderId,
    points: e.points,
    sharePct: totalPoints > 0 ? e.points / totalPoints : 0,
    tokenAmount: pool != null && totalPoints > 0 ? (e.points / totalPoints) * pool : null,
    rank: i + 1,
  }));

  return {
    allocations,
    totalPoints,
    eligible: allocations.length,
    excluded: entries.length - allocations.length,
  };
}

/**
 * Canonical bytes the manifest hash covers: `wallet,points`, one per line,
 * sorted by wallet. Shares and ranks are excluded on purpose — they are derived
 * from these two numbers, so hashing them too would let a formatting change
 * (rounding, a different pool size) invalidate a hash that should still hold.
 */
export function canonicalLines(allocations: Allocation[]): string {
  return [...allocations]
    .sort((a, b) => a.wallet.localeCompare(b.wallet))
    .map((a) => `${a.wallet},${a.points}`)
    .join("\n");
}

export function manifestHash(allocations: Allocation[]): string {
  return createHash("sha256").update(canonicalLines(allocations)).digest("hex");
}

/**
 * The published CSV. Columns are ordered so `wallet,points` are first two — the
 * exact pair the hash is taken over — which lets a verifier hash the first two
 * columns straight back to the manifest with a one-liner.
 */
export function toCsv(allocations: Allocation[]): string {
  const header = "wallet,points,rank,share_pct,token_amount";
  const rows = allocations.map(
    (a) =>
      `${a.wallet},${a.points},${a.rank},${(a.sharePct * 100).toFixed(6)},${
        a.tokenAmount != null ? a.tokenAmount.toFixed(6) : ""
      }`,
  );
  return [header, ...rows].join("\n") + "\n";
}

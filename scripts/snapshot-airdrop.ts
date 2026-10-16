/**
 * $pemp airdrop — the freeze.
 *
 * Turns "everyone who used us early gets $pemp" into a list of wallets with
 * numbers next to them, hashed and published before the token exists.
 *
 * The hard part is not the split; it is that the split can only be taken once.
 * After $pemp trades, every incentive points at gaming whatever formula decides
 * who is owed what, so eligibility has to be a fact about a *past* moment rather
 * than a query that can be re-run and re-argued. Everything here is in service of
 * that: build the allocation from activity up to a cutoff, hash the canonical
 * (wallet, points) list, write it down immutably, and print the hash.
 *
 * Reuses the app's own economy. `pointsFor` (lib/points.ts) is the exact function
 * the public leaderboard ranks on, so what the airdrop pays is the same number
 * the site already shows a user. That is deliberate — a reward is only fair if a
 * user could have predicted it, and they can: it is on /top today.
 *
 * Two things `pointsFor` counts are point-in-time and cannot be cut off, because
 * they are denormalised running totals, not timestamped rows:
 *   - engagement received (likes / comments / shares) on a trader's clips
 *   - follower count
 * Everything else — clips posted, trades, SOL traded, creator fees earned — is
 * filtered to `createdAt <= cutoff`, so it is exact. The practical rule: run this
 * AT the announced cutoff, not months later, and the running totals are correct
 * too, because nothing has happened since.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";
import type { PointStats } from "../lib/points";
import {
  DEFAULT_CRITERIA,
  buildAllocations,
  manifestHash,
  toCsv,
} from "../lib/airdrop";
import type { WalletStat } from "../lib/airdrop";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const label = arg("label");
  if (!label) {
    console.error(
      "ERROR: --label is required (e.g. --label genesis-2026-03).\n" +
        "Snapshots are immutable and keyed by label; it can never be reused.",
    );
    process.exit(1);
  }

  const cutoff = arg("cutoff") ? new Date(arg("cutoff") as string) : new Date();
  if (Number.isNaN(cutoff.getTime())) {
    console.error("ERROR: --cutoff is not a valid date. Use an ISO string.");
    process.exit(1);
  }

  const minPoints = Number(arg("min-points") ?? DEFAULT_CRITERIA.minPoints);
  const poolArg = arg("pool");
  const pool = poolArg != null ? Number(poolArg) : null;
  if (poolArg != null && (!Number.isFinite(pool) || (pool as number) <= 0)) {
    console.error("ERROR: --pool must be a positive number.");
    process.exit(1);
  }
  const dry = flag("dry");

  console.log(`==> $pemp airdrop snapshot`);
  console.log(`    label     : ${label}`);
  console.log(`    cutoff    : ${cutoff.toISOString()}`);
  console.log(`    min points: ${minPoints}`);
  console.log(`    pool      : ${pool ?? "(unset — shares frozen, amounts later)"}`);
  console.log(`    mode      : ${dry ? "DRY RUN (no writes)" : "APPLY"}`);

  // Refuse to overwrite. A snapshot is a fact about a moment; re-taking it under
  // the same label is exactly the move this table exists to prevent.
  const existing = await prisma.airdropSnapshot.findUnique({ where: { label } });
  if (existing) {
    console.error(
      `ERROR: snapshot "${label}" already exists (hash ${existing.manifestHash}).\n` +
        `Snapshots are immutable. Pick a new label.`,
    );
    process.exit(1);
  }

  const [traders, clipAgg, tradeAgg, rewardAgg] = await Promise.all([
    prisma.trader.findMany({
      where: { walletAddress: { not: null } },
      select: { id: true, walletAddress: true, followerCount: true },
    }),
    // Clips posted up to the cutoff. The engagement sums are the denormalised
    // running totals noted in the header — read as-of-now, hence "run at cutoff".
    prisma.clip.groupBy({
      by: ["uploadedById"],
      where: { uploadedById: { not: null }, createdAt: { lte: cutoff } },
      _count: { _all: true },
      _sum: { likes: true, comments: true, shares: true },
    }),
    prisma.trade.groupBy({
      by: ["traderId"],
      where: { createdAt: { lte: cutoff } },
      _count: { _all: true },
      _sum: { solAmount: true },
    }),
    prisma.trade.groupBy({
      by: ["creatorWallet"],
      where: { creatorWallet: { not: null }, createdAt: { lte: cutoff } },
      _sum: { creatorFeeSol: true },
    }),
  ]);

  const clipBy = new Map(clipAgg.map((c) => [c.uploadedById as string, c]));
  const tradeBy = new Map(tradeAgg.map((t) => [t.traderId, t]));
  const rewardBy = new Map(
    rewardAgg.map((r) => [r.creatorWallet as string, r._sum.creatorFeeSol ?? 0]),
  );

  const entries: WalletStat[] = traders.map((t) => {
    const c = clipBy.get(t.id);
    const tr = tradeBy.get(t.id);
    const stats: PointStats = {
      clips: c?._count._all ?? 0,
      likes: c?._sum.likes ?? 0,
      comments: c?._sum.comments ?? 0,
      shares: c?._sum.shares ?? 0,
      followers: t.followerCount,
      trades: tr?._count._all ?? 0,
      volumeSol: tr?._sum.solAmount ?? 0,
      rewardsSol: t.walletAddress ? rewardBy.get(t.walletAddress) ?? 0 : 0,
    };
    return { wallet: t.walletAddress as string, traderId: t.id, stats };
  });

  const { allocations, totalPoints, eligible, excluded } = buildAllocations(entries, {
    minPoints,
    pool,
  });
  const hash = manifestHash(allocations);

  console.log(`\n==> result`);
  console.log(`    traders with a wallet : ${entries.length}`);
  console.log(`    eligible (>= min)     : ${eligible}`);
  console.log(`    excluded by threshold : ${excluded}`);
  console.log(`    total points          : ${totalPoints}`);
  console.log(`    manifest hash         : ${hash}`);

  if (eligible > 0) {
    console.log(`\n==> top 10`);
    for (const a of allocations.slice(0, 10)) {
      const pct = (a.sharePct * 100).toFixed(3);
      const amt = a.tokenAmount != null ? `  ${a.tokenAmount.toFixed(2)} $pemp` : "";
      console.log(
        `    #${String(a.rank).padStart(4)}  ${a.wallet}  ${String(a.points).padStart(8)} pts  ${pct}%${amt}`,
      );
    }
    const smallest = allocations[allocations.length - 1];
    console.log(
      `\n    smallest allocation: ${smallest.points} pts (${(smallest.sharePct * 100).toFixed(5)}%)`,
    );
  }

  const csv = toCsv(allocations);

  if (dry) {
    const dir = join(process.cwd(), ".clip-tmp");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `airdrop-${label}.preview.csv`);
    writeFileSync(path, csv);
    console.log(`\n==> dry run: wrote preview CSV to ${path}. Nothing written to the DB.`);
    return;
  }

  // Publish the CSV alongside the snapshot so anyone can verify the hash by
  // hashing the (wallet, points) columns back. Vercel serves public/ statically.
  const dir = join(process.cwd(), "public", "airdrop");
  mkdirSync(dir, { recursive: true });
  const csvPath = join(dir, `${label}.csv`);
  writeFileSync(csvPath, csv);

  const snapshot = await prisma.$transaction(async (tx) => {
    const snap = await tx.airdropSnapshot.create({
      data: {
        label,
        cutoff,
        criteria: {
          ...DEFAULT_CRITERIA,
          minPoints,
          appliedAt: new Date().toISOString(),
        },
        manifestHash: hash,
        totalWallets: eligible,
        totalPoints,
        tokenPool: pool,
      },
    });
    // createMany in chunks — one INSERT per few hundred wallets keeps the
    // statement well inside any plan/packet limit on pooled connections.
    const CHUNK = 500;
    for (let i = 0; i < allocations.length; i += CHUNK) {
      await tx.airdropAllocation.createMany({
        data: allocations.slice(i, i + CHUNK).map((a) => ({
          snapshotId: snap.id,
          wallet: a.wallet,
          points: a.points,
          sharePct: a.sharePct,
          tokenAmount: a.tokenAmount,
          rank: a.rank,
          traderId: a.traderId,
        })),
      });
    }
    return snap;
  });

  console.log(`\n==> APPLIED`);
  console.log(`    snapshot id : ${snapshot.id}`);
  console.log(`    csv         : ${csvPath}`);
  console.log(`    hash        : ${hash}`);
  console.log(
    `\nPublish the hash (and the CSV) before the token exists. That is what makes\n` +
      `the split verifiable — anyone can hash the CSV's wallet,points columns back\n` +
      `and confirm it matches.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

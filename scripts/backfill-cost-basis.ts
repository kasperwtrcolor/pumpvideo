/**
 * Recompute every position's cost basis from the immutable fill log.
 *
 * The live-trade confirm route used to leave `costSol` untouched on a partial
 * sell, so selling half a position left the remainder carrying the cost of the
 * whole thing. That is fixed going forward, but rows written before the fix
 * still hold the inflated figure — and an inflated basis is not a cosmetic
 * problem: the header renders PnL as value − basis, so those accounts read as a
 * large loss they never took.
 *
 * The Trade table is the source of truth here: it is append-only and every row
 * carries the raw token amount and the SOL that moved. Replaying it with the
 * corrected average-cost rule reconstructs what the basis should be.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   ./scripts/with-prod-env.sh npx tsx scripts/backfill-cost-basis.ts
 *   ./scripts/with-prod-env.sh npx tsx scripts/backfill-cost-basis.ts --apply
 */
import { prisma } from "../lib/db";

const APPLY = process.argv.includes("--apply");

type Fill = { side: string; tokenAmount: string; solAmount: number };

/** Average-cost replay. Mirrors the rule now in the live confirm route. */
function replay(fills: Fill[]): number {
  let held = 0n;
  let basis = 0;
  for (const f of fills) {
    const raw = BigInt(f.tokenAmount);
    if (f.side === "BUY") {
      held += raw;
      basis += f.solAmount;
      continue;
    }
    // SELL
    const heldNum = Number(held);
    if (held - raw <= 0n) {
      held = 0n;
      basis = 0;
      continue;
    }
    const fraction = heldNum > 0 ? Number(raw) / heldNum : 0;
    basis = Math.max(0, basis * (1 - fraction));
    held -= raw;
  }
  return basis;
}

async function main() {
  const positions = await prisma.position.findMany({
    select: { id: true, traderId: true, coinId: true, tokenAmount: true, costSol: true },
  });

  let checked = 0;
  let wrong = 0;
  let fixed = 0;

  for (const p of positions) {
    checked++;
    const coin = await prisma.coin.findUnique({
      where: { id: p.coinId },
      select: { mint: true, symbol: true },
    });
    if (!coin) continue;

    const trades = await prisma.trade.findMany({
      where: { traderId: p.traderId, coinMint: coin.mint, mode: "LIVE" },
      orderBy: { createdAt: "asc" },
      select: { side: true, tokenAmount: true, solAmount: true },
    });
    if (trades.length === 0) continue;

    const want = replay(trades);
    // Float noise at 1e-12 is not a discrepancy worth a write.
    if (Math.abs(want - p.costSol) < 1e-9) continue;

    wrong++;
    console.log(
      `${coin.symbol.padEnd(12)} basis ${p.costSol.toFixed(6)} -> ${want.toFixed(6)} SOL` +
        `  (held ${(Number(p.tokenAmount) / 1e6).toFixed(4)})`,
    );

    if (APPLY) {
      await prisma.position.update({ where: { id: p.id }, data: { costSol: want } });
      fixed++;
    }
  }

  console.log(
    `\n${checked} positions checked, ${wrong} carrying an inflated basis, ${fixed} rewritten` +
      (APPLY ? "" : "  — dry run, pass --apply to write"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Reconcile stored positions against the wallet's real on-chain balance.
 *
 * The keeper runs the same repair every tick (see lib/reconcile.ts); this is the
 * manual entry point, and it dry-runs by default so a repair is never a
 * surprise.
 *
 *   ./scripts/with-prod-env.sh npx tsx scripts/reconcile-positions.ts
 *   ./scripts/with-prod-env.sh npx tsx scripts/reconcile-positions.ts --apply
 */
import { prisma } from "../lib/db";
import { reconcilePositions } from "../lib/reconcile";

const APPLY = process.argv.includes("--apply");

async function main() {
  const r = await reconcilePositions({ apply: APPLY, limit: 500 });
  console.log(
    `${r.checked} positions checked, ${r.drifted} out of step with the chain, ` +
      `${r.written} rewritten, ${r.failed} unreadable` +
      (APPLY ? "" : "  — dry run, pass --apply to write"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

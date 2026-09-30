/**
 * Market keeper (cron entry point).
 *
 *   npx tsx scripts/sync.ts [--limit 40] [--ingest 8]
 *
 * Thin wrapper over lib/keeper.ts, so the cron and the HTTP route can never
 * drift apart. Installed on the VPS to run every 5 minutes (see
 * scripts/install-keeper.sh) because Vercel Hobby cron may only run once per day.
 *
 * `--ingest N` also pulls the newest N launched tokens and filters them (see
 * lib/ingest.ts for the guards). It is off by default and the VPS cron opts in:
 * the HTTP route shares this code path and a serverless invocation should not be
 * sweeping pump.fun for new coins.
 *
 * `--reconcile N` re-reads the chain for up to N open positions and corrects any
 * whose stored holding has drifted (see lib/reconcile.ts). Also off by default
 * for the same reason — one RPC read per position — and also opted into by the
 * VPS cron.
 */
import { prisma } from "../lib/db";
import { runKeeper } from "../lib/keeper";

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const LIMIT = arg("limit", 40);
const INGEST = arg("ingest", 0);
const RECONCILE = arg("reconcile", 0);

async function main() {
  const r = await runKeeper({ limit: LIMIT, ingest: INGEST, reconcile: RECONCILE });

  console.log(
    `sync: checked ${r.checked}, updated ${r.updated} ` +
      `(dex ${r.viaDex} / pumpfun ${r.viaPumpfun}), notFound ${r.notFound}`,
  );
  if (r.ingested) {
    // Both numbers, so a tick that looked at 40 launches and kept 3 is visibly
    // working rather than suspiciously quiet.
    console.log(
      `ingest: considered ${r.ingested.considered}, +${r.ingested.coins} coins, ` +
        `+${r.ingested.clips} clips, skipped ${r.ingested.skipped} (filters)`,
    );
  }
  if (r.reconciled && r.reconciled.drifted > 0) {
    console.log(
      `reconcile: ${r.reconciled.checked} positions read, ${r.reconciled.drifted} out of ` +
        `step with the chain, ${r.reconciled.written} corrected`,
    );
  }
  if (r.errors.length) console.log(`errors (${r.errors.length}): ${r.errors.join(" | ")}`);
  if (r.sweepErrors.length) {
    console.log(`sweep failures (${r.sweepErrors.length}): ${r.sweepErrors.join(" | ")}`);
  }
  if (r.note) console.log(`WARNING: nothing updated — ${r.note}.`);

  // Non-zero exit when the keeper accomplished nothing, so a cron wrapper or
  // log watcher can actually see the failure instead of a cheerful log line.
  //
  // An ingest that landed new coins counts as accomplishing something even if
  // no price moved — otherwise a quiet-but-working tick would report as a
  // failure and train everyone to ignore the alert.
  const didSomething = r.updated > 0 || (r.ingested?.coins ?? 0) > 0;
  if (r.checked > 0 && !didSomething) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

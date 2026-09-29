/**
 * Market keeper (cron entry point).
 *
 *   npx tsx scripts/sync.ts [--limit 40]
 *
 * Thin wrapper over lib/keeper.ts, so the cron and the HTTP route can never
 * drift apart. Installed on the VPS to run every 5 minutes (see
 * scripts/install-keeper.sh) because Vercel Hobby cron may only run once per day.
 */
import { prisma } from "../lib/db";
import { runKeeper } from "../lib/keeper";

const i = process.argv.indexOf("--limit");
const LIMIT = i === -1 ? 40 : Number(process.argv[i + 1]) || 40;

async function main() {
  const r = await runKeeper({ limit: LIMIT });

  console.log(
    `sync: checked ${r.checked}, updated ${r.updated} ` +
      `(dex ${r.viaDex} / pumpfun ${r.viaPumpfun}), notFound ${r.notFound}`,
  );
  if (r.errors.length) console.log(`errors (${r.errors.length}): ${r.errors.join(" | ")}`);
  if (r.sweepErrors.length) {
    console.log(`sweep failures (${r.sweepErrors.length}): ${r.sweepErrors.join(" | ")}`);
  }
  if (r.note) console.log(`WARNING: nothing updated — ${r.note}.`);

  // Non-zero exit when the keeper accomplished nothing, so a cron wrapper or
  // log watcher can actually see the failure instead of a cheerful log line.
  if (r.checked > 0 && r.updated === 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Dead-token retention sweep.
 *
 *   npx tsx scripts/retention.ts                    # dry run, default 3-day grace
 *   npx tsx scripts/retention.ts --apply            # soft-hide the dead ones
 *   npx tsx scripts/retention.ts --apply --hard     # delete them outright
 *   npx tsx scripts/retention.ts --grace-days 14    # longer grace
 *
 * Dry run is the default and changes nothing. That matters here: the decision
 * depends on a live pump.fun sweep, so the only way to know what a run would do
 * is to run the reasoning — there is no cheaper preview that is not a different
 * computation from the real thing (see lib/retention.ts).
 *
 * `--hard` is deletion and cannot be undone. It only ever reaches coins with no
 * user-uploaded clip, no open position, no follower and no trade history, so a
 * user's content is never what disappears. But a deleted art card does not come
 * back, whereas a hidden one can be restored the moment the token trades again —
 * which is why hiding is the default.
 *
 * Installed daily on the VPS (see scripts/retention-cron.sh). Deliberately NOT
 * part of the 5-minute keeper: both drive the same pump.fun sweep endpoint, and
 * running retention at that cadence would spend the ingest tick's rate-limit
 * budget to re-derive an answer that changes on the order of days.
 */
import { prisma } from "../lib/db";
import { planRetention, applyRetention, restoreRevived, hideDust } from "../lib/retention";
import { DEFAULT_GRACE_DAYS, DEFAULT_LIMIT } from "../lib/retention";
import { MIN_HOLDERS } from "../lib/holders";

function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const APPLY = process.argv.includes("--apply");
const HARD = process.argv.includes("--hard");
const GRACE = numArg("grace-days", DEFAULT_GRACE_DAYS);
const LIMIT = numArg("limit", DEFAULT_LIMIT);

async function main() {
  if (HARD && !APPLY) {
    console.log("--hard needs --apply. Refusing to delete by accident.");
    process.exitCode = 1;
    return;
  }
  const mode = HARD ? "delete" : "hide";

  // Dust gate first. It is a single database read (no sweep) and it removes the
  // bulk of the catalogue, so the expensive dead-token sweep below has far less
  // to consider. `--hard` is deliberately not honoured here: a sub-30-holder
  // coin can still recover, so these are only ever hidden, never deleted.
  const dust = await hideDust({ limit: LIMIT, apply: APPLY });
  console.log(
    `dust: ${dust.candidates} coins older than 1h below ${MIN_HOLDERS} holders` +
      (APPLY ? `, hidden ${dust.hidden}` : " (dry run — pass --apply to hide)"),
  );

  const plan = await planRetention({ graceDays: GRACE, limit: LIMIT });

  console.log(
    `retention: grace ${plan.graceDays}d (cutoff ${plan.cutoff.toISOString()}), ` +
      `mode ${APPLY ? mode : "dry-run"}`,
  );
  console.log(
    `  candidates ${plan.candidates.length} ` +
      `(scanned up to ${LIMIT}, minus coins with a trade history)`,
  );
  console.log(
    `  of those: ${plan.dead.length} dead ` +
      `(${plan.unranked.length} fallen out of the rankings, ` +
      `${plan.dead.length - plan.unranked.length} still listed below the ` +
      `floor), ${plan.alive.length} still alive`,
  );
  console.log(
    `  held back: ${plan.skipped.userClip} with a user-uploaded clip, ` +
      `${plan.skipped.position} with an open position, ` +
      `${plan.skipped.followed} followed, ` +
      `${plan.skipped.traded} with trade history`,
  );

  if (!plan.actionable) {
    console.log(
      `REFUSING to act — the pump.fun sweep was incomplete ` +
        `(${plan.sweepErrors.length} page failure(s)). A partial view cannot ` +
        `tell a dead coin from one nobody managed to look at.`,
    );
    for (const e of plan.sweepErrors.slice(0, 5)) console.log(`    ${e}`);
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    if (plan.dead.length > 0) {
      console.log("  would affect (first 10):");
      for (const c of plan.dead.slice(0, 10)) {
        console.log(`    $${c.symbol}  ${c.mint}  created ${c.createdAt.toISOString().slice(0, 10)}`);
      }
    }
    console.log("  dry run — nothing changed. Re-run with --apply.");
    return;
  }

  const result = await applyRetention(plan, mode);
  if (result.refused) {
    console.log(`REFUSING to act — ${result.refused}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `  ${mode === "delete" ? "deleted" : "hidden"} ${result.applied} of ${result.planned}`,
  );

  const revived = await restoreRevived({ limit: LIMIT });
  if (revived.restored > 0) {
    console.log(`  restored ${revived.restored} of ${revived.checked} that recovered`);
  } else {
    console.log(`  nothing to restore (${revived.checked} hidden coins checked)`);
  }
  if (revived.sweepErrors.length) {
    console.log(
      `  note: pump.fun sweep incomplete (${revived.sweepErrors.length} page failure(s)); ` +
        `restore fell back to holder counts only`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

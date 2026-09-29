/**
 * Guards against "asset drift": the database says a clip is `ready`, but the
 * mp4/jpg behind it was never committed to the repo, so Vercel 404s the <video>.
 *
 * This shipped broken once — the feed rendered 121 coins while 83 of their clips
 * 404'd — and it is invisible from the app's own health checks, because
 * /api/stats only counts DB rows, not files on disk.
 *
 * Run before every deploy:
 *   npm run verify-assets
 *
 * Exits non-zero on any mismatch so it can gate a deploy.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CLIPS = join(process.cwd(), "public", "clips");
const THUMBS = join(process.cwd(), "public", "thumbs");

/** Everything git knows about, as a Set, so we don't shell out per file. */
function trackedFiles(): Set<string> {
  const out = execFileSync("git", ["ls-files", "public/clips", "public/thumbs"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Set(out.split("\n").filter(Boolean));
}

async function main() {
  const tracked = trackedFiles();

  const clips = await prisma.clip.findMany({
    where: { ready: true },
    select: { id: true, coin: { select: { mint: true, symbol: true } } },
  });

  const missingOnDisk: string[] = [];
  const missingInGit: string[] = [];

  for (const clip of clips) {
    const { mint, symbol } = clip.coin;
    for (const [dir, ext] of [
      [CLIPS, "mp4"],
      [THUMBS, "jpg"],
    ] as const) {
      const abs = join(dir, `${mint}.${ext}`);
      const rel = `public/${dir === CLIPS ? "clips" : "thumbs"}/${mint}.${ext}`;
      if (!existsSync(abs)) missingOnDisk.push(`${symbol} (${rel})`);
      else if (!tracked.has(rel)) missingInGit.push(`${symbol} (${rel})`);
    }
  }

  const total = await prisma.clip.count();

  console.log(`ready clips : ${clips.length} / ${total} total`);
  console.log(`tracked     : ${tracked.size} asset file(s)`);

  if (missingOnDisk.length) {
    console.log(`\nMISSING ON DISK (${missingOnDisk.length}):`);
    for (const m of missingOnDisk.slice(0, 20)) console.log(`  ${m}`);
    if (missingOnDisk.length > 20) console.log(`  ... +${missingOnDisk.length - 20} more`);
  }
  if (missingInGit.length) {
    console.log(`\nUNCOMMITTED — will 404 on Vercel (${missingInGit.length}):`);
    for (const m of missingInGit.slice(0, 20)) console.log(`  ${m}`);
    if (missingInGit.length > 20) console.log(`  ... +${missingInGit.length - 20} more`);
  }

  if (missingOnDisk.length || missingInGit.length) {
    console.log(
      `\nFAIL — ${missingOnDisk.length + missingInGit.length} problem(s). ` +
        `Run \`npm run clips\` then commit public/clips + public/thumbs.`,
    );
    process.exit(1);
  }

  console.log("\nOK — every ready clip has a committed asset.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";

async function main() {
  const clips = await prisma.clip.findMany({ include: { coin: true } });
  const wanted = new Set(clips.map((c) => c.coin.mint));

  const dir = join(process.cwd(), "public", "clips");
  const onDisk = readdirSync(dir)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => f.replace(/\.mp4$/, ""));

  const orphans = onDisk.filter((m) => !wanted.has(m));
  const missing = [...wanted].filter((m) => !existsSync(join(dir, `${m}.mp4`)));

  console.log(`db clips: ${clips.length} | files: ${onDisk.length}`);
  console.log(`orphans (on disk, not in db): ${orphans.length}`);
  console.log(`missing (in db, no file): ${missing.length}`);

  // Size profile of the clips that actually ship.
  const sized = clips
    .map((c) => {
      const p = join(dir, `${c.coin.mint}.mp4`);
      return {
        symbol: c.coin.symbol,
        size: existsSync(p) ? statSync(p).size : 0,
      };
    })
    .sort((a, b) => a.size - b.size);

  const small = sized.filter((s) => s.size < 60000);
  console.log(`\nshipping clips under 60KB: ${small.length}`);
  for (const s of small.slice(0, 15)) console.log(`  ${String(s.size).padStart(7)}  $${s.symbol}`);

  console.log(`\nsmallest 5 overall:`);
  for (const s of sized.slice(0, 5)) console.log(`  ${String(s.size).padStart(7)}  $${s.symbol}`);

  if (process.argv.includes("--prune") && orphans.length) {
    const { rmSync } = await import("node:fs");
    let removed = 0;
    for (const m of orphans) {
      for (const ext of ["mp4"]) {
        const p = join(dir, `${m}.${ext}`);
        if (existsSync(p)) {
          rmSync(p);
          removed++;
        }
      }
      const t = join(process.cwd(), "public", "thumbs", `${m}.jpg`);
      if (existsSync(t)) {
        rmSync(t);
        removed++;
      }
    }
    console.log(`\npruned ${removed} orphaned files`);
  }

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

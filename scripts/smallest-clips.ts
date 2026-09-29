import { statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";

/** Print "<mint> <symbol>" for the N smallest shipping clips (QA contact sheets). */
async function main() {
  const n = Number(process.argv[2] || 8);
  const clips = await prisma.clip.findMany({ include: { coin: true } });
  const dir = join(process.cwd(), "public", "clips");
  const rows = clips
    .map((c) => {
      const p = join(dir, `${c.coin.mint}.mp4`);
      return { mint: c.coin.mint, symbol: c.coin.symbol, size: existsSync(p) ? statSync(p).size : 0 };
    })
    .sort((a, b) => a.size - b.size)
    .slice(0, n);
  for (const r of rows) console.log(`${r.mint} ${r.symbol.trim().replace(/\s+/g, "_")} ${r.size}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

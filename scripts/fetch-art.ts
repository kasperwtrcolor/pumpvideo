import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";
import { fetchArt, artExt, artCandidates } from "../lib/art";

/**
 * Download a coin's art (through the gateway chain) into /tmp so it can be
 * eyeballed against the clip that was rendered from it.
 */
async function main() {
  const mint = process.argv[2];
  const coin = await prisma.coin.findUnique({ where: { mint } });
  if (!coin) {
    console.log("no such mint");
    return;
  }
  console.log(`$${coin.symbol} (${coin.name})`);
  console.log(`imageUrl: ${coin.imageUrl}`);
  console.log(`candidates: ${JSON.stringify(artCandidates(coin.imageUrl), null, 1)}`);

  const art = await fetchArt(coin.imageUrl);
  if (!art) {
    console.log("ART FETCH FAILED — no candidate answered");
    return;
  }
  const out = join("/tmp", `art-${coin.symbol.replace(/[^a-z0-9]/gi, "_")}.${artExt(art.contentType)}`);
  writeFileSync(out, art.buf);
  console.log(`saved ${art.buf.length} bytes from ${art.source}`);
  console.log(`path: ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

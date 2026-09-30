/**
 * Rasterise the Pogo mark into the icon set the app ships.
 *
 * Source of truth is public/logo.svg — edit that (or the React mark in
 * components/Logo.tsx) and re-run `node scripts/gen-icons.mjs` to refresh
 * the PNGs. The SVG renders at 384 dpi so 512px stays crisp.
 */
import sharp from "sharp";
import { readFileSync } from "fs";

const svg = readFileSync(new URL("../public/logo.svg", import.meta.url));
const root = new URL("../", import.meta.url).pathname;

const targets = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-icon.png", 180],
  ["app/apple-icon.png", 180],
  ["public/og-icon.png", 400],
];

for (const [rel, size] of targets) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(root + rel);
  console.log("wrote", rel, `${size}x${size}`);
}

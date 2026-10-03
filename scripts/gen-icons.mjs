/**
 * Rasterise the Pemp mark into the icon set the app ships.
 *
 * Source of truth is public/brand/logo.png — the 500px master (already
 * corner-masked to transparency). Replace that file and re-run
 * `node scripts/gen-icons.mjs` to refresh every PNG the app and the browser
 * chrome consume. It is also the image the in-app mark renders (public/logo.png).
 */
import sharp from "sharp";
import { readFileSync } from "fs";

const master = readFileSync(new URL("../public/brand/logo.png", import.meta.url));
const root = new URL("../", import.meta.url).pathname;

const targets = [
  ["public/logo.png", 256],
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/apple-icon.png", 180],
  ["app/apple-icon.png", 180],
  ["app/icon.png", 512],
  ["public/og-icon.png", 400],
];

for (const [rel, size] of targets) {
  await sharp(master)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(root + rel);
  console.log("wrote", rel, `${size}x${size}`);
}

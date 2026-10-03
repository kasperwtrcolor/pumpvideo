/**
 * Rasterise the Pemp mark into the icon set the app ships.
 *
 * Source of truth is public/brand/logo.png — the 500px master, already
 * corner-masked to transparency. Replace that file and re-run
 * `node scripts/gen-icons.mjs` to refresh every PNG (and the favicon) the app
 * and the browser chrome consume. It is also the image the in-app mark renders
 * (public/logo.png).
 *
 * The .ico is written here rather than by a dependency: an ICO that embeds PNG
 * frames is valid on every browser that matters, so packing three sizes by hand
 * is cheaper than adding a package for a file that changes once a rebrand.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";

const master = readFileSync(new URL("../public/brand/logo.png", import.meta.url));
const root = new URL("../", import.meta.url).pathname;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

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
    .resize(size, size, { fit: "contain", background: transparent })
    .png({ compressionLevel: 9 })
    .toFile(root + rel);
  console.log("wrote", rel, `${size}x${size}`);
}

// --- favicon.ico: three PNG frames packed into one ICO --------------------
const sizes = [16, 32, 48];
const frames = await Promise.all(
  sizes.map((s) =>
    sharp(master).resize(s, s, { fit: "contain", background: transparent }).png().toBuffer()
  )
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(frames.length, 4);

let offset = 6 + 16 * frames.length;
const entries = frames.map((buf, i) => {
  const s = sizes[i];
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0); // width (0 = 256)
  e.writeUInt8(s >= 256 ? 0 : s, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  return e;
});

writeFileSync(root + "public/favicon.ico", Buffer.concat([header, ...entries, ...frames]));
console.log("wrote public/favicon.ico", sizes.join("/"));

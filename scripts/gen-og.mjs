/**
 * Build the social share card (1200x630, the OpenGraph/Twitter ratio).
 *
 * Composed from the shipped raster assets (the mark and the mascots) plus an
 * SVG layer for the words, so it stays on-brand without pulling in a rendering
 * dependency. Re-run after the logo or mascots change:
 *   node scripts/gen-og.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "fs";

const W = 1200;
const H = 630;
const accent = "#22e06a";
const ink = "#f4f4f6";
const muted = "#8b8b98";
const bg = "#08080a";
const root = new URL("../", import.meta.url).pathname;
const clear = { r: 0, g: 0, b: 0, alpha: 0 };

const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="0.1" cy="0.06" r="0.75">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.20"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="300" y="268" font-family="DejaVu Sans" font-weight="bold" font-size="116"
        letter-spacing="8" fill="${ink}">PEMP</text>
  <text x="304" y="348" font-family="DejaVu Sans" font-size="46" fill="${accent}">Where clips pay.</text>
  <text x="304" y="408" font-family="DejaVu Sans" font-size="27" fill="${muted}">Every clip is a coin you can buy — on Solana.</text>
  <text x="84" y="582" font-family="DejaVu Sans" font-weight="bold" font-size="30"
        letter-spacing="1" fill="${muted}">pemp.fun</text>
</svg>`;

const buf = await sharp(Buffer.from(text))
  .composite([
    {
      input: await sharp(root + "public/brand/logo.png").resize(170, 170, { fit: "contain", background: clear }).toBuffer(),
      left: 84,
      top: 120,
    },
    {
      input: await sharp(root + "public/brand/dog.png").resize(150, 150, { fit: "contain", background: clear }).toBuffer(),
      left: 660,
      top: 430,
    },
    {
      input: await sharp(root + "public/brand/pepe.png").resize(140, 140, { fit: "contain", background: clear }).toBuffer(),
      left: 810,
      top: 440,
    },
    {
      input: await sharp(root + "public/brand/cat.png").resize(150, 150, { fit: "contain", background: clear }).toBuffer(),
      left: 950,
      top: 430,
    },
    {
      input: await sharp(root + "public/brand/solana.png").resize(110, 110, { fit: "contain", background: clear }).toBuffer(),
      left: 1085,
      top: 455,
    },
  ])
  .png()
  .toBuffer();

for (const rel of ["app/opengraph-image.png", "app/twitter-image.png", "public/og-image.png"]) {
  writeFileSync(root + rel, buf);
  console.log("wrote", rel);
}

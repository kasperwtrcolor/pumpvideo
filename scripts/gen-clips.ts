/**
 * Generate a vertical 9:16 clip for every clip row that doesn't have a video yet.
 *
 *   npx tsx scripts/gen-clips.ts [--limit 40] [--force] [--concurrency 2] [--mint <addr>]
 *
 * In production this stage is the transcoder: ingest a source video -> ffmpeg ->
 * HLS ladder -> object storage. Here we synthesise a clip from the coin's art so
 * the feed has something real to play, and so the pipeline shape is identical.
 *
 * Art resolution goes through lib/art.ts, which rewrites IPFS URLs onto gateways
 * that actually answer. Before that fix, ipfs.io 403'd us and half the feed
 * rendered as black cards.
 *
 * Rendering is two passes on purpose:
 *   1. composite a single still frame (blurred art backdrop + crisp art + text)
 *   2. animate that still with a slow zoompan
 * Doing it in one pass with `-loop 1` on the art looks equivalent but is not:
 * ffmpeg's image2 demuxer, when looping a single PNG, fails to re-read it
 * ("Invalid PNG signature 0x2020202020202020") and the whole render falls over
 * into the text-only fallback. Animating a still dodges that entirely.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";
import { fetchArt, artExt, extractCid } from "../lib/art";

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const PUBLIC = join(process.cwd(), "public");
const CLIPS = join(PUBLIC, "clips");
const THUMBS = join(PUBLIC, "thumbs");
const TMP = join(process.cwd(), ".clip-tmp");

const DURATION = 5;
const FPS = 24;
const W = 720;
const H = 1280;
const FRAMES = DURATION * FPS;

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const LIMIT = arg("limit", 400);
const CONCURRENCY = arg("concurrency", 2);
const FORCE = process.argv.includes("--force");
const ONLY = (() => {
  const i = process.argv.indexOf("--mint");
  return i === -1 ? null : process.argv[i + 1];
})();

function esc(p: string) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** ffmpeg-safe single-line text (no newlines, no colons, no backslashes). */
function sanitize(s: string) {
  return s.replace(/[\r\n]+/g, " ").replace(/[:'\\%]/g, "").slice(0, 42);
}

function run(args: string[]) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", ...args], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${r.status}): ${(r.stderr || "").slice(-400)}`);
  }
}

/**
 * Pass 1 — composite one still frame.
 *
 * With art: the art fills the frame as a blurred, darkened backdrop and a crisp
 * copy sits centred. No burned-in text: the feed overlays the coin name, ticker,
 * price and market cap itself, and duplicating them inside the video made the
 * two collide at the bottom of the panel.
 * Without art (rare — a handful of dead image hosts): a coloured gradient card
 * carrying the ticker, so the clip is still identifiable rather than anonymous.
 */
function renderStill(opts: { image: string | null; out: string; textFile: string; tickerFile: string }) {
  const { image, out, textFile, tickerFile } = opts;

  const label =
    `drawtext=fontfile=${FONT}:textfile=${esc(textFile)}:fontcolor=white@0.96:` +
    `fontsize=46:line_spacing=8:x=(w-text_w)/2:y=h-330:` +
    `box=1:boxcolor=0x000000@0.5:boxborderw=18`;

  const ticker =
    `drawtext=fontfile=${FONT}:textfile=${esc(tickerFile)}:fontcolor=white@0.98:` +
    `fontsize=72:x=(w-text_w)/2:y=h*0.5-text_h/2:shadowcolor=black@0.7:shadowx=3:shadowy=3`;

  const args = image
    ? [
        "-i", image,
        "-filter_complex",
        [
          // Blur at 1/16 resolution then scale back up. A sigma-30 gaussian over
          // 720x1280 is the single most expensive thing in the render, and for a
          // backdrop nobody can tell the difference — this cut render time by
          // roughly 4x.
          `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
            `scale=180:320,gblur=sigma=8,scale=${W}:${H},` +
            `eq=brightness=-0.30:saturation=1.15[bg]`,
          `[0:v]scale=620:-1:force_original_aspect_ratio=decrease[fg]`,
          `[bg][fg]overlay=(W-w)/2:(H-h)/2[t]`,
        ].join(";"),
        "-map", "[t]", "-frames:v", "1", out,
      ]
    : [
        "-f", "lavfi", "-i",
        `gradients=s=${W}x${H}:c0=0x232345:c1=0x0d0d14:x0=0:y0=0:x1=${W}:y1=${H}:nb_colors=2`,
        "-filter_complex", `[0:v]${ticker},${label}[t]`,
        "-map", "[t]", "-frames:v", "1", out,
      ];

  run(args);
}

/** Pass 2 — animate the still into a DURATION-second vertical clip. */
function animate(still: string, out: string) {
  run([
    "-i", still,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-filter_complex",
    `[0:v]format=yuv420p,zoompan=z='min(zoom+0.0012,1.15)':d=${FRAMES}:` +
      `s=${W}x${H}:fps=${FPS},format=yuv420p[v]`,
    "-map", "[v]", "-map", "1:a",
    "-t", String(DURATION),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "48k", "-ar", "44100",
    "-movflags", "+faststart",
    out,
  ]);
}

function buildThumb(video: string, out: string) {
  const r = spawnSync(
    "ffmpeg",
    ["-nostdin", "-y", "-loglevel", "error", "-i", video, "-vf", "scale=360:-1", "-frames:v", "1", out],
    { encoding: "utf8" },
  );
  if (r.status !== 0) console.warn(`  thumb failed for ${out}`);
}

async function main() {
  mkdirSync(CLIPS, { recursive: true });
  mkdirSync(THUMBS, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  const clips = await prisma.clip.findMany({
    where: ONLY ? { coin: { mint: ONLY } } : undefined,
    include: { coin: true },
    orderBy: { rank: "desc" },
    take: LIMIT,
  });

  // Anything without an asset on disk still needs work. Already-rendered clips
  // are kept in the list so we can repair the DB flag rather than re-encode.
  const todo = clips.filter(
    (c) => FORCE || !c.ready || !existsSync(join(CLIPS, `${c.coin.mint}.mp4`)),
  );
  console.log(`${clips.length} clips found, ${todo.length} need rendering`);
  if (todo.length === 0) return;

  let done = 0;
  let failed = 0;
  let withArt = 0;
  let noArt = 0;
  const failures: string[] = [];

  async function worker(slice: typeof todo) {
    for (const clip of slice) {
      const mint = clip.coin.mint;
      const out = join(CLIPS, `${mint}.mp4`);
      const thumb = join(THUMBS, `${mint}.jpg`);
      const still = join(TMP, `${mint}.still.png`);

      // Asset already on disk: just make sure the feed is allowed to serve it.
      if (!FORCE && existsSync(out) && existsSync(thumb) && !clip.ready) {
        await prisma.clip.update({
          where: { id: clip.id },
          data: { ready: true, videoUrl: `/clips/${mint}.mp4` },
        });
        done++;
        continue;
      }

      const txt = join(TMP, `${mint}.txt`);
      const big = join(TMP, `${mint}.big.txt`);
      writeFileSync(txt, sanitize(`${clip.coin.name} · $${clip.coin.symbol}`), "utf8");
      writeFileSync(big, sanitize(`$${clip.coin.symbol}`), "utf8");

      // Resolve art through the gateway chain.
      const art = await fetchArt(clip.coin.imageUrl);
      let img: string | null = null;
      if (art) {
        img = join(TMP, `${mint}.${artExt(art.contentType)}`);
        writeFileSync(img, art.buf);
        withArt++;
      } else {
        noArt++;
        if (clip.coin.imageUrl) {
          const cid = extractCid(clip.coin.imageUrl);
          console.warn(
            `  art unavailable for $${clip.coin.symbol}` +
              (cid ? ` (ipfs ${cid.slice(0, 14)}…)` : ` (${clip.coin.imageUrl.slice(0, 60)})`),
          );
        }
      }

      try {
        // Pass 1 can fail on a malformed image; pass 2 shouldn't. If the art
        // path throws we retry the still without art rather than shipping a hole.
        try {
          renderStill({ image: img, out: still, textFile: txt, tickerFile: big });
        } catch (e) {
          if (!img) throw e;
          console.warn(`  still failed for $${clip.coin.symbol}, retrying without art: ${(e as Error).message.slice(0, 120)}`);
          renderStill({ image: null, out: still, textFile: txt, tickerFile: big });
        }

        animate(still, out);
        buildThumb(out, thumb);
        // Flip the clip live only after the asset exists on disk — and point it
        // at the file. An art-only clip (videoUrl null, written by the ingester
        // before any render existed) is upgraded here; without this it would
        // stay an art card forever even with the video sitting on disk.
        await prisma.clip.update({
          where: { id: clip.id },
          data: { ready: true, videoUrl: `/clips/${mint}.mp4` },
        });
        done++;
        console.log(`  [${done + failed}/${todo.length}] $${clip.coin.symbol}${img ? "" : " (no art)"}`);
      } catch (e) {
        failed++;
        failures.push(clip.coin.symbol);
        console.warn(
          `  [${done + failed}/${todo.length}] $${clip.coin.symbol} FAILED: ${(e as Error).message.slice(0, 200)}`,
        );
      }
    }
  }

  const buckets: (typeof todo)[] = Array.from({ length: CONCURRENCY }, () => []);
  todo.forEach((c, i) => buckets[i % CONCURRENCY].push(c));
  await Promise.all(buckets.map(worker));

  rmSync(TMP, { recursive: true, force: true });
  console.log(`rendered ${done}, failed ${failed} (art ${withArt}, no-art ${noArt})`);
  if (failures.length) console.log(`failed symbols: ${failures.join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

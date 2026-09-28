/**
 * Generate a vertical 9:16 clip for every clip row that doesn't have a video yet.
 *
 *   npx tsx scripts/gen-clips.ts [--limit 40] [--force] [--concurrency 2]
 *
 * In production this stage is the transcoder: ingest a source video -> ffmpeg ->
 * HLS ladder -> object storage. Here we synthesise a clip from the coin's art so
 * the feed has something real to play, and so the pipeline shape is identical.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const PUBLIC = join(process.cwd(), "public");
const CLIPS = join(PUBLIC, "clips");
const THUMBS = join(PUBLIC, "thumbs");
const TMP = join(process.cwd(), ".clip-tmp");

const DURATION = 5;
const FPS = 24;
const W = 720;
const H = 1280;

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const LIMIT = arg("limit", 40);
const CONCURRENCY = arg("concurrency", 2);
const FORCE = process.argv.includes("--force");

function esc(p: string) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** ffmpeg-safe single-line text (no newlines, no colons, no backslashes). */
function sanitize(s: string) {
  return s.replace(/[\r\n]+/g, " ").replace(/[:'\\%]/g, "").slice(0, 42);
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return false;
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

function buildClip(opts: {
  image: string | null;
  symbol: string;
  name: string;
  out: string;
  textFile: string;
}) {
  const { image, name, out, textFile } = opts;

  const text =
    `drawtext=fontfile=${FONT}:textfile=${esc(textFile)}:fontcolor=white@0.95:` +
    `fontsize=46:line_spacing=8:x=(w-text_w)/2:y=h-330:` +
    `box=1:boxcolor=0x000000@0.45:boxborderw=18`;

  let chain: string;
  if (image) {
    chain = [
      `[0:v]scale=${W}:-1:force_original_aspect_ratio=decrease,format=rgba[logo]`,
      `color=c=0x0B0B0D:s=${W}x${H}:d=${DURATION},format=rgba[bg]`,
      `[bg][logo]overlay=(W-w)/2:(H-h)/2-120[comp]`,
      `[comp]${text}[t]`,
      `[t]format=yuv420p,zoompan=z='min(zoom+0.0009,1.08)':d=${DURATION * FPS}:s=${W}x${H}:fps=${FPS},format=yuv420p[v]`,
    ].join(";");
  } else {
    chain = [
      `color=c=0x101014:s=${W}x${H}:d=${DURATION},format=yuv420p[bg]`,
      `[bg]${text}[t]`,
      `[t]format=yuv420p,zoompan=z='min(zoom+0.0009,1.08)':d=${DURATION * FPS}:s=${W}x${H}:fps=${FPS},format=yuv420p[v]`,
    ].join(";");
  }

  const args = [
    "-y",
    "-loglevel", "error",
    ...(image ? ["-loop", "1", "-i", image] : []),
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-filter_complex", chain,
    "-map", "[v]",
    // audio input index shifts depending on whether we prepended the image input
    "-map", image ? "1:a" : "0:a",
    "-t", String(DURATION),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "48k", "-ar", "44100",
    "-movflags", "+faststart",
    out,
  ];

  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${r.status}): ${(r.stderr || "").slice(-500)}`);
  }
  void name;
}

function buildThumb(video: string, out: string) {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", video, "-vf", "scale=360:-1", "-frames:v", "1", out],
    { encoding: "utf8" },
  );
  if (r.status !== 0) console.warn(`  thumb failed for ${out}`);
}

async function main() {
  mkdirSync(CLIPS, { recursive: true });
  mkdirSync(THUMBS, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  const clips = await prisma.clip.findMany({
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

  let done = 0;
  let failed = 0;

  async function worker(slice: typeof todo) {
    for (const clip of slice) {
      const mint = clip.coin.mint;
      const out = join(CLIPS, `${mint}.mp4`);
      const thumb = join(THUMBS, `${mint}.jpg`);

      // Asset already on disk: just make sure the feed is allowed to serve it.
      if (!FORCE && existsSync(out) && existsSync(thumb) && !clip.ready) {
        await prisma.clip.update({ where: { id: clip.id }, data: { ready: true } });
        done++;
        continue;
      }

      const img = join(TMP, `${mint}.img`);
      const txt = join(TMP, `${mint}.txt`);

      writeFileSync(txt, sanitize(`${clip.coin.name} · $${clip.coin.symbol}`), "utf8");

      let hasImage = false;
      if (clip.coin.imageUrl) {
        hasImage = await download(clip.coin.imageUrl, img);
      }

      try {
        buildClip({
          image: hasImage ? img : null,
          symbol: clip.coin.symbol,
          name: clip.coin.name,
          out,
          textFile: txt,
        });
        buildThumb(out, thumb);
        // Flip the clip live only after the asset exists on disk.
        await prisma.clip.update({
          where: { id: clip.id },
          data: { ready: true },
        });
        done++;
        console.log(`  [${done + failed}/${todo.length}] ${clip.coin.symbol}`);
      } catch (e) {
        // Coin art can lie about its format (an X/Twitter CDN link returning HTML,
        // or a mislabelled JPEG served as .png). Retry as a text-only card rather
        // than shipping a hole in the feed.
        try {
          if (!hasImage) throw e;
          buildClip({
            image: null,
            symbol: clip.coin.symbol,
            name: clip.coin.name,
            out,
            textFile: txt,
          });
          buildThumb(out, thumb);
          await prisma.clip.update({ where: { id: clip.id }, data: { ready: true } });
          done++;
          console.log(`  [${done + failed}/${todo.length}] ${clip.coin.symbol} (text fallback)`);
        } catch {
          failed++;
          console.warn(
            `  [${done + failed}/${todo.length}] ${clip.coin.symbol} FAILED: ${(e as Error).message.slice(0, 160)}`,
          );
        }
      }
    }
  }

  const buckets: (typeof todo)[] = Array.from({ length: CONCURRENCY }, () => []);
  todo.forEach((c, i) => buckets[i % CONCURRENCY].push(c));
  await Promise.all(buckets.map(worker));

  rmSync(TMP, { recursive: true, force: true });
  console.log(`rendered ${done}, failed ${failed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

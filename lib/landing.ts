import { prisma } from "@/lib/db";
import { artUrl } from "@/lib/art-url";
import { VISIBLE_COIN } from "@/lib/visibility";

/**
 * The artwork for the welcome screen's wall.
 *
 * Assembled on the server, deliberately. Doing this in the component would mean
 * the wall paints as brand-gradient placeholders and then swaps to real art a
 * moment later — a visible flash, on the very first screen anyone sees. Reading
 * it here puts real tokens in the first paint instead.
 *
 * Real catalogue data, never stock imagery: the background is a claim about what
 * the app is, so it had better be what the app is actually serving.
 */
export type LandingTile = { art: string | null; video: string | null };

/**
 * How many moving-video tiles the wall carries.
 *
 * Small on purpose. A dozen decoding videos in an animated container looks no
 * better than two and costs real battery, and these are the ones most likely to
 * be slow, so they are a garnish rather than a load-bearing part of the wall.
 */
const MAX_VIDEOS = 2;

/** Enough art to overfill each of the three columns several times over. */
const ART_TILES = 60;

/**
 * Moving tiles that ship with the app, used to top the wall up when the
 * catalogue has fewer live clips than the wall wants. Without them a fresh
 * deploy paints a wall of nothing but stills — the wall is the first thing
 * anyone sees, and a still wall undersells a video product.
 */
const BUNDLED_VIDEOS = ["/landing/1.mp4", "/landing/2.mp4"];

export async function landingTiles(): Promise<LandingTile[]> {
  const [coins, clips] = await Promise.all([
    // Largest first: recognition is the point of the wall, and the bigger tokens
    // are the ones with finished, non-blank artwork.
    prisma.coin.findMany({
      where: { ...VISIBLE_COIN, imageUrl: { not: null } },
      orderBy: { marketCapSol: "desc" },
      take: ART_TILES,
      select: { imageUrl: true },
    }),
    prisma.clip.findMany({
      where: { ready: true, videoUrl: { not: null } },
      orderBy: { rank: "desc" },
      take: MAX_VIDEOS,
      select: { videoUrl: true },
    }),
  ]);

  const tiles: LandingTile[] = [];
  for (const c of coins) {
    const art = artUrl(c.imageUrl);
    if (art) tiles.push({ art, video: null });
  }

  let videos = 0;
  for (const c of clips) {
    if (c.videoUrl) {
      tiles.push({ art: null, video: c.videoUrl });
      videos++;
    }
  }
  // Top up from the shipped clips, so the wall is always moving.
  for (const src of BUNDLED_VIDEOS) {
    if (videos >= MAX_VIDEOS) break;
    tiles.push({ art: null, video: src });
    videos++;
  }
  return tiles;
}

/**
 * A coin launched *through* Pemp.
 *
 * Distinct from `LandingTile`: this is not scenery, it is a link to a real coin
 * someone minted here, so it carries the identity (mint, symbol, name) and the
 * age the showcase shows. `provider: "SELF"` is the marker — every ingested coin
 * is PUMPFUN/STONKFUN/DEXSCREENER, so SELF unambiguously means "launched here".
 */
export type LaunchTile = {
  mint: string;
  symbol: string;
  name: string;
  art: string | null;
  /** The launch video, when the creator gave one — the front door to the coin. */
  video: string | null;
  /** Milliseconds since the launch, for the "2h ago" label. */
  ageMs: number;
};

/**
 * The newest coins launched through Pemp, newest first.
 *
 * Empty is the expected state for a while and is not an error — the showcase
 * renders an invitation instead. Kept small: this is a proof that the thing
 * works, not a second index (that is what /coins is for).
 */
export async function launchShowcase(limit = 12): Promise<LaunchTile[]> {
  const coins = await prisma.coin.findMany({
    where: { ...VISIBLE_COIN, provider: "SELF" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      mint: true,
      symbol: true,
      name: true,
      imageUrl: true,
      createdAt: true,
      clips: {
        where: { ready: true, videoUrl: { not: null } },
        orderBy: { rank: "desc" },
        take: 1,
        select: { videoUrl: true },
      },
    },
  });

  const now = Date.now();
  return coins.map((c) => ({
    mint: c.mint,
    symbol: c.symbol,
    name: c.name,
    art: artUrl(c.imageUrl),
    video: c.clips[0]?.videoUrl ?? null,
    ageMs: now - c.createdAt.getTime(),
  }));
}


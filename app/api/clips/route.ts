import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { fetchCoin, toCoinRecord } from "@/lib/pumpfun";
import {
  MAX_UPLOAD_BYTES,
  downloadTokenFor,
  downloadUrl,
  objectOwnedBy,
  storageConfigured,
} from "@/lib/gcs";

export const dynamic = "force-dynamic";

const Body = z.object({
  object: z.string().min(10).max(300),
  tokenAddress: z.string().min(32).max(48),
  caption: z.string().trim().max(280).optional(),
});

/** Read the stored object's real size back from storage. */
async function measureObject(object: string): Promise<number | null> {
  const url = downloadUrl(object, downloadTokenFor(object));
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    const len = head.headers.get("content-length");
    if (head.ok && len) return Number(len);
  } catch {
    /* fall through to a ranged read */
  }
  try {
    // One byte is enough to learn the total from content-range.
    const r = await fetch(url, { headers: { range: "bytes=0-0" }, cache: "no-store" });
    const cr = r.headers.get("content-range");
    const total = cr?.split("/")[1];
    if (total && Number.isFinite(Number(total))) return Number(total);
  } catch {
    /* give up */
  }
  return null;
}

/**
 * POST /api/clips — register an uploaded video as a clip bound to a token.
 *
 * Login required. The caller supplies the object path returned by
 * /api/uploads/presign; we check it really is inside their own folder, then read
 * its true size back from storage. Declared sizes and client-side checks are
 * conveniences — this is the check that actually holds, because by now the bytes
 * are sitting in a bucket we control.
 *
 * The token address is looked up against live pump.fun data and, if we have not
 * seen it before, indexed on the spot. Whatever wallet uploaded the clip becomes
 * its creator, and therefore the wallet that earns the 1% creator fee on every
 * buy made through it.
 */
export async function POST(req: NextRequest) {
  // Auth first: an anonymous caller gets a uniform 401 and cannot probe whether
  // storage is configured on this deployment.
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  if (!storageConfigured()) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }

  const limit = rateLimit(`clipcreate:${clientKey(req)}`, 6, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", detail: "too many uploads, wait a moment" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  // Ownership: the path must be under this trader's own folder.
  if (!objectOwnedBy(parsed.object, trader.id)) {
    return NextResponse.json(
      { error: "NOT_YOUR_UPLOAD", detail: "that object does not belong to this account" },
      { status: 403 },
    );
  }

  let mint: string;
  try {
    mint = new PublicKey(parsed.tokenAddress).toBase58();
  } catch {
    return NextResponse.json(
      { error: "BAD_TOKEN", detail: "that is not a valid Solana token address" },
      { status: 400 },
    );
  }

  const bytes = await measureObject(parsed.object);
  if (bytes === null) {
    return NextResponse.json(
      { error: "UPLOAD_NOT_FOUND", detail: "the uploaded video could not be read back" },
      { status: 404 },
    );
  }
  if (bytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "TOO_LARGE",
        detail: `video is ${(bytes / 1024 / 1024).toFixed(1)} MB — the limit is ${(
          MAX_UPLOAD_BYTES / 1024 / 1024
        ).toFixed(0)} MB`,
        bytes,
      },
      { status: 413 },
    );
  }

  // Bind to the coin, indexing it first if this is a token we have never seen.
  let coin = await prisma.coin.findUnique({ where: { mint } });
  if (!coin) {
    const live = await fetchCoin(mint).catch(() => null);
    if (!live) {
      return NextResponse.json(
        {
          error: "UNKNOWN_TOKEN",
          detail: "no live market found for that token address — it must be a pump.fun token",
        },
        { status: 422 },
      );
    }
    const record = toCoinRecord(live);
    coin = await prisma.coin.upsert({
      where: { mint: record.mint },
      create: { ...record, change24hPct: 0, holders: 0, isBanned: Boolean(live.is_banned) },
      update: { ...record, isBanned: Boolean(live.is_banned) },
    });
  }

  const clip = await prisma.clip.create({
    data: {
      coinId: coin.id,
      source: "UPLOAD",
      videoUrl: downloadUrl(parsed.object, downloadTokenFor(parsed.object)),
      thumbUrl: null,
      ready: true,
      caption: parsed.caption ?? null,
      author: trader.displayName || trader.handle.replace(/^anon-/, "").slice(0, 8),
      // No wallet means no creator payout — the 1% falls through to the treasury
      // rather than being silently dropped.
      creatorWallet: trader.walletAddress,
      uploadedById: trader.id,
    },
  });

  return NextResponse.json({
    ok: true,
    clip: {
      id: clip.id,
      videoUrl: clip.videoUrl,
      caption: clip.caption,
      author: clip.author,
      creatorWallet: clip.creatorWallet,
      sizeBytes: bytes,
    },
    coin: { mint: coin.mint, symbol: coin.symbol },
  });
}

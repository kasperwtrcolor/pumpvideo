import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { SOLANA_RPC } from "@/lib/pumpfun";
import {
  downloadTokenFor,
  downloadUrl,
  objectOwnedByLaunch,
  storageConfigured,
  uploadObject,
  launchMetadataPath,
} from "@/lib/gcs";
import { buildCreateTransaction, buildMetadata, resolveQuote } from "@/lib/launch";

export const dynamic = "force-dynamic";

/**
 * POST /api/launch/prepare
 * Authorization: Bearer <privy access token>
 *
 * Step 1 of 3 for a real launch:
 *   1. (here) upload the metadata, then build an UNSIGNED `create_v2` tx
 *   2. (browser) sign with the throwaway mint keypair, then the creator's wallet
 *   3. POST /api/launch/confirm records the coin and its first clip
 *
 * This handler never sees a private key. The mint keypair is generated in the
 * browser and only its *public* address is sent here, which is enough to build
 * the instruction. The creator pays the mint rent and the transaction fee, so
 * the payer is the creator's own wallet.
 */
const Body = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10),
  description: z.string().trim().max(500).optional(),
  /** The generated mint account's public address. */
  mint: z.string().min(32).max(48),
  poolPair: z.enum(["SOL", "USDC", "CUSTOM"]),
  customMint: z.string().trim().min(32).max(48).optional(),
  rewardTo: z.enum(["CREATOR", "HOLDERS"]),
  /** Uploaded media object path — the video, or the image when no video was given. */
  mediaObject: z.string().min(10).max(300),
  /** Uploaded image object path — the coin's art (video thumbnail, or the image itself). */
  imageObject: z.string().min(10).max(300),
  twitter: z.string().trim().max(200).optional(),
  telegram: z.string().trim().max(200).optional(),
  website: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  if (!storageConfigured()) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!trader.walletAddress) {
    return NextResponse.json(
      { error: "NO_WALLET", detail: "no wallet is attached to this account" },
      { status: 409 },
    );
  }

  const limit = rateLimit(`launch:${clientKey(req)}`, 6, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", detail: "too many launches, wait a moment" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  // Both objects must be inside this trader's own launch folder.
  for (const object of [parsed.mediaObject, parsed.imageObject]) {
    if (!objectOwnedByLaunch(object, trader.id)) {
      return NextResponse.json(
        { error: "NOT_YOUR_UPLOAD", detail: "an upload does not belong to this account" },
        { status: 403 },
      );
    }
  }

  let mint: PublicKey;
  try {
    mint = new PublicKey(parsed.mint);
  } catch {
    return NextResponse.json(
      { error: "BAD_MINT", detail: "that is not a valid Solana mint address" },
      { status: 400 },
    );
  }

  const connection = new Connection(SOLANA_RPC, "confirmed");

  // The mint must be brand new. If it already exists on chain, or is already in
  // our catalogue, this is a replay of an old keypair and create_v2 would fail.
  const [existingAccount, existingCoin] = await Promise.all([
    connection.getAccountInfo(mint).catch(() => null),
    prisma.coin.findUnique({ where: { mint: mint.toBase58() }, select: { id: true } }),
  ]);
  if (existingAccount || existingCoin) {
    return NextResponse.json(
      { error: "MINT_IN_USE", detail: "that mint already exists — generate a fresh one" },
      { status: 409 },
    );
  }

  const mediaUrl = downloadUrl(parsed.mediaObject, downloadTokenFor(parsed.mediaObject));
  const imageUrl = downloadUrl(parsed.imageObject, downloadTokenFor(parsed.imageObject));

  // Write the metadata document pump.fun's indexer and every other client will
  // read. Done server-side because it is small and has to be live before the
  // create transaction lands.
  const metadata = buildMetadata({
    name: parsed.name,
    symbol: parsed.symbol,
    description: parsed.description,
    imageUrl,
    videoUrl: parsed.mediaObject !== parsed.imageObject ? mediaUrl : undefined,
    twitter: parsed.twitter,
    telegram: parsed.telegram,
    website: parsed.website,
  });

  let uri: string;
  try {
    uri = await uploadObject({
      object: launchMetadataPath(trader.id),
      contentType: "application/json",
      body: metadata,
    });
  } catch (e) {
    console.error("[launch:prepare:metadata]", e);
    return NextResponse.json(
      { error: "METADATA_UPLOAD_FAILED", detail: "could not publish the coin metadata" },
      { status: 502 },
    );
  }

  let quote;
  try {
    quote = await resolveQuote(connection, parsed.poolPair, parsed.customMint);
  } catch (e) {
    return NextResponse.json(
      { error: "BAD_POOL_PAIR", detail: (e as Error).message },
      { status: 400 },
    );
  }

  let transaction: string;
  try {
    transaction = await buildCreateTransaction({
      connection,
      payer: new PublicKey(trader.walletAddress),
      mint,
      name: parsed.name,
      symbol: parsed.symbol,
      uri,
      rewardTo: parsed.rewardTo,
      quoteMint: quote.quoteMint,
      quoteTokenProgram: quote.quoteTokenProgram,
    });
  } catch (e) {
    console.error("[launch:prepare:build]", e);
    return NextResponse.json(
      { error: "BUILD_FAILED", detail: "could not build the launch transaction" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    mint: mint.toBase58(),
    uri,
    transaction,
    poolPair: quote.label,
    rewardTo: parsed.rewardTo,
    // A rough floor the creator needs in the wallet to cover mint rent + fee.
    estimatedLamports: 22_000_000,
    imageUrl,
    mediaUrl,
  });
}

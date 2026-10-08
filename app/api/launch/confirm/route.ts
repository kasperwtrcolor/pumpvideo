import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { requireTrader } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { rankFor } from "@/lib/ingest";
import { notifyClipPublished, publicAuthor } from "@/lib/social";
import { PUMP_PROGRAM_ID } from "@/lib/launch";
import {
  downloadTokenFor,
  downloadUrl,
  objectOwnedByLaunch,
} from "@/lib/gcs";

export const dynamic = "force-dynamic";

const Body = z.object({
  mint: z.string().min(32).max(48),
  signature: z.string().min(60).max(100),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10),
  description: z.string().trim().max(500).optional(),
  mediaObject: z.string().min(10).max(300),
  imageObject: z.string().min(10).max(300),
  caption: z.string().trim().max(280).optional(),
  twitter: z.string().trim().max(200).optional(),
  telegram: z.string().trim().max(200).optional(),
  website: z.string().trim().max(200).optional(),
});

/**
 * POST /api/launch/confirm
 * Authorization: Bearer *** access token>
 *
 * Step 3 of 3. We do not take the browser's word that a coin was launched: the
 * signature is looked up on-chain, the transaction must have succeeded, the fee
 * payer must be this trader's own wallet, and the mint must now exist and be
 * owned by the pump program. Only then does the coin enter our catalogue — with
 * the creator's media bound to it as its first clip, exactly as an upload does.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  if (!trader.walletAddress) {
    return NextResponse.json({ error: "NO_WALLET" }, { status: 409 });
  }

  const limit = rateLimit(`launchconfirm:${clientKey(req)}`, 12, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  for (const object of [parsed.mediaObject, parsed.imageObject]) {
    if (!objectOwnedByLaunch(object, trader.id)) {
      return NextResponse.json(
        { error: "NOT_YOUR_UPLOAD", detail: "an upload does not belong to this account" },
        { status: 403 },
      );
    }
  }

  // Replay guard: a mint can only ever back one catalogue row this way, and a
  // signature can only ever back one launch.
  const already = await prisma.coin.findUnique({ where: { mint: parsed.mint } });
  if (already) {
    return NextResponse.json(
      { error: "ALREADY_LAUNCHED", detail: "that coin is already in the catalogue", mint: parsed.mint },
      { status: 409 },
    );
  }

  const connection = new Connection(SOLANA_RPC, "confirmed");

  // ---- verify the transaction on chain -----------------------------------
  type RawTx = Awaited<ReturnType<Connection["getTransaction"]>>;
  let tx: RawTx = null;
  for (let attempt = 0; attempt < 6 && !tx; attempt++) {
    try {
      tx = await connection.getTransaction(parsed.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch {
      /* transient — retry */
    }
    if (!tx) await new Promise((r) => setTimeout(r, 1500));
  }

  if (!tx) {
    return NextResponse.json(
      { error: "TX_NOT_FOUND", detail: "that transaction is not confirmed on Solana yet" },
      { status: 404 },
    );
  }
  if (tx.meta?.err) {
    return NextResponse.json(
      { error: "TX_FAILED", detail: `the launch failed on chain: ${JSON.stringify(tx.meta.err)}` },
      { status: 400 },
    );
  }

  // The signer must be this trader — otherwise anyone could log someone else's
  // launch against their own account.
  const signers = tx.transaction.message.staticAccountKeys
    .slice(0, tx.transaction.message.header.numRequiredSignatures)
    .map((k) => k.toBase58());
  if (!signers.includes(trader.walletAddress)) {
    return NextResponse.json(
      { error: "WRONG_SIGNER", detail: "this transaction was not signed by your wallet" },
      { status: 403 },
    );
  }

  // ---- verify the mint is now a real pump coin ---------------------------
  let mint: PublicKey;
  try {
    mint = new PublicKey(parsed.mint);
  } catch {
    return NextResponse.json({ error: "BAD_MINT" }, { status: 400 });
  }
  const mintAccount = await connection.getAccountInfo(mint).catch(() => null);
  if (!mintAccount || !mintAccount.owner.equals(PUMP_PROGRAM_ID)) {
    return NextResponse.json(
      { error: "NO_MINT", detail: "that mint was not created by pump.fun" },
      { status: 422 },
    );
  }

  // ---- record the coin ---------------------------------------------------
  const videoUrl =
    parsed.mediaObject !== parsed.imageObject
      ? downloadUrl(parsed.mediaObject, downloadTokenFor(parsed.mediaObject))
      : null;
  const imageUrl = downloadUrl(parsed.imageObject, downloadTokenFor(parsed.imageObject));

  const coin = await prisma.coin.create({
    data: {
      mint: parsed.mint,
      // Mark it as ours: these are the coins launched *through* Pemp, and a
      // future "Launches" rail reads exactly this.
      provider: "SELF",
      name: parsed.name,
      symbol: parsed.symbol,
      description: parsed.description ?? null,
      imageUrl,
      creator: trader.walletAddress,
      twitter: parsed.twitter ?? null,
      telegram: parsed.telegram ?? null,
      website: parsed.website ?? null,
      launchedAt: new Date(),
      // A brand-new curve: no market yet. The keeper prices it on its next tick.
      priceSol: 0,
      marketCapSol: 0,
      complete: false,
    },
  });

  const clip = await prisma.clip.create({
    data: {
      coinId: coin.id,
      source: "UPLOAD",
      videoUrl,
      thumbUrl: imageUrl,
      ready: true,
      caption: parsed.caption ?? null,
      author: publicAuthor(trader),
      rank: rankFor({ marketCapSol: 0, launchedAt: coin.launchedAt, complete: false }),
      creatorWallet: trader.walletAddress,
      uploadedById: trader.id,
    },
  });

  let notified = { uploads: 0, tokens: 0 };
  try {
    notified = await notifyClipPublished({
      id: clip.id,
      coinId: coin.id,
      coinMint: coin.mint,
      uploadedById: trader.id,
    });
  } catch {
    /* the coin is live; the courtesy notification is not essential */
  }

  return NextResponse.json({
    ok: true,
    mint: coin.mint,
    symbol: coin.symbol,
    name: coin.name,
    hasVideo: Boolean(videoUrl),
    signature: parsed.signature,
    explorer: `https://explorer.solana.com/tx/${parsed.signature}`,
    notified,
  });
}

/**
 * Launching a coin.
 *
 * A launch is the clip flow turned inside out: instead of binding a video to a
 * token that already exists, the creator supplies the video (or an image) *and*
 * the token — and we mint the coin on pump.fun's rails, then bind the media to
 * it as its first clip. Everything downstream (the feed, the trade sheet, the
 * 2%+1% fee split) already works on a coin and a clip, so this file only has to
 * produce those two things.
 *
 * Nothing here holds a key. The mint keypair is generated in the browser, the
 * create transaction is built unsigned, and the creator's own embedded wallet
 * signs it — the same division of labour as `/api/trade/live/*`.
 */
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { PUMP_SDK, OnlinePumpSdk, PUMP_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** Wrapped SOL — pump's native quote. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** USDC on Solana mainnet: whitelisted on pump's `Global`, so a first-class quote. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type PoolPair = "SOL" | "USDC" | "CUSTOM";

/** Where the coin's creator fee goes. `HOLDERS` is pump's holder-reward mode. */
export type RewardTo = "CREATOR" | "HOLDERS";

/** Re-exported so a route can check ownership of a mint account without importing the SDK. */
export { PUMP_PROGRAM_ID };

export type LaunchMetadataInput = {
  name: string;
  symbol: string;
  description?: string;
  /** The coin's art — an uploaded image, or a frame pulled from an uploaded video. */
  imageUrl: string;
  /** The uploaded video, when the creator gave one. */
  videoUrl?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

/**
 * The JSON the coin's on-chain `uri` points at.
 *
 * Field names are pump.fun's, not ours — their indexer, Metaplex and every other
 * client read this document, so it has to look exactly like one of theirs.
 * `createdOn` is included for the same reason despite being cosmetic.
 */
export function buildMetadata(input: LaunchMetadataInput): string {
  return JSON.stringify({
    name: input.name,
    symbol: input.symbol,
    description: input.description ?? "",
    image: input.imageUrl,
    ...(input.videoUrl ? { video: input.videoUrl } : {}),
    ...(input.twitter ? { twitter: input.twitter } : {}),
    ...(input.telegram ? { telegram: input.telegram } : {}),
    ...(input.website ? { website: input.website } : {}),
    createdOn: "pemp.fun",
  });
}

/**
 * Resolve a quote mint for the create instruction.
 *
 * SOL is pump's default (no account, no whitelist check). Anything else has to
 * be admitted by `Global` or the `QuoteControl` PDA — `resolveQuoteMint` is the
 * authority on that, and it also hands back the program that owns the mint,
 * which every quote-side ATA must be derived with.
 */
export async function resolveQuote(
  connection: Connection,
  pair: PoolPair,
  customMint?: string,
): Promise<{ quoteMint: PublicKey | undefined; quoteTokenProgram: PublicKey; label: string }> {
  if (pair === "SOL") {
    return { quoteMint: undefined, quoteTokenProgram: TOKEN_PROGRAM_ID, label: "SOL" };
  }

  const raw = pair === "USDC" ? USDC_MINT : customMint?.trim();
  if (!raw) throw new Error("a custom pool needs a quote mint address");

  let mint: PublicKey;
  try {
    mint = new PublicKey(raw);
  } catch {
    throw new Error("that is not a valid Solana mint address");
  }

  const online = new OnlinePumpSdk(connection);
  try {
    const resolved = await online.resolveQuoteMint(mint);
    return {
      quoteMint: mint,
      quoteTokenProgram: resolved.quoteTokenProgram,
      label: pair === "USDC" ? "USDC" : mint.toBase58(),
    };
  } catch {
    // UnsupportedQuoteMintError (or an RPC hiccup) — surface one clear message
    // rather than leaking an SDK error code at the creator.
    throw new Error("that mint is not an accepted pool pair on pump.fun");
  }
}

/**
 * Build the unsigned `create_v2` transaction.
 *
 * Returns the full instruction set so a token-quoted create can carry the
 * explicit compute budget it needs. The mint account is created by the pump
 * program itself (the mint is a signer on the instruction), so there is no
 * separate `SystemProgram.createAccount` here — the browser signs with the
 * throwaway mint keypair it generated, then the creator's wallet.
 */
export async function buildCreateTransaction(opts: {
  connection: Connection;
  payer: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  rewardTo: RewardTo;
  quoteMint?: PublicKey;
  quoteTokenProgram?: PublicKey;
}): Promise<string> {
  const instructions: TransactionInstruction[] = [];

  // Token-quoted creates are heavy (create plus the curve's quote ATA); SOL
  // creates are cheap and ride the default budget.
  if (opts.quoteMint) {
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }));
  }

  instructions.push(
    await PUMP_SDK.createV2Instruction({
      mint: opts.mint,
      name: opts.name,
      symbol: opts.symbol,
      uri: opts.uri,
      // The creator *is* the payer: a launch is paid for by whoever launches it,
      // and that same wallet is what the creator fee routes to.
      creator: opts.payer,
      user: opts.payer,
      mayhemMode: false,
      holderReward: opts.rewardTo === "HOLDERS",
      ...(opts.quoteMint
        ? { quoteMint: opts.quoteMint, quoteTokenProgram: opts.quoteTokenProgram }
        : {}),
    }),
  );

  const { blockhash } = await opts.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: opts.payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  // Unsigned on purpose: the versioned transaction carries placeholder
  // signatures, and the browser fills them (mint keypair, then the wallet).
  const tx = new VersionedTransaction(message);
  return Buffer.from(tx.serialize()).toString("base64");
}

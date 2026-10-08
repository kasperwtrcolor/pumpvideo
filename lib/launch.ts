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
import type { PumpQuoteAccounts } from "@pump-fun/pump-sdk";
import {
  CurveDepthExceededError,
  QuoteBondingCurveNotEligibleError,
  QuoteCurveAwaitingMigrationError,
  QuoteReservesOutOfRangeError,
  UnsupportedQuoteMintError,
} from "@pump-fun/pump-sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** Wrapped SOL — pump's native quote. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * The on-chain `uri` byte cap. pump's `create_v2` rejects a longer one with
 * `UriTooLong` (6045) — and only at simulation time, so it has to be checked
 * before the transaction is handed to the creator.
 */
export const MAX_URI_BYTES = 200;

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
 * be admitted by one of three routes, and `resolveQuoteMint` is the authority
 * on all of them: the `Global` whitelist (USDC), the `QuoteControl` PDA
 * (pump.fun-listed assets such as xStocks), or — since the 4.0.0 program —
 * *being a pump coin itself*. That last route is the "pair your coin with any
 * other coin" feature: any live pump.fun coin can quote a new coin. It also
 * hands back the program that owns the mint, which every quote-side ATA is
 * derived with, plus the currency account the create needs when the quote is a
 * live pump curve (`pumpQuote`).
 */
export async function resolveQuote(
  connection: Connection,
  pair: PoolPair,
  customMint?: string,
): Promise<{
  quoteMint: PublicKey | undefined;
  quoteTokenProgram: PublicKey;
  /** Set only when the quote is a pump coin (neither listed on `Global` nor in QuoteControl). */
  pumpQuote?: PumpQuoteAccounts;
  label: string;
}> {
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
      // A pump coin is admitted through its own curve, which the create has to
      // carry. `accounts` is empty until the coin has migrated; passing the
      // (possibly empty) object is what makes the builder append the curve.
      pumpQuote:
        resolved.source === "pumpCoin" ? (resolved.pumpQuote?.accounts ?? {}) : undefined,
      label: pair === "USDC" ? "USDC" : mint.toBase58(),
    };
  } catch (e) {
    throw new Error(resolveQuoteMessage(e));
  }
}

/**
 * One clear sentence for why a mint cannot be a pool pair, rather than an SDK
 * error code. The typed errors come off `resolveQuoteMint`.
 */
function resolveQuoteMessage(e: unknown): string {
  if (e instanceof UnsupportedQuoteMintError) {
    return "that mint is not a pump.fun coin, so it can't be paired with — pick a coin launched on pump.fun";
  }
  if (e instanceof CurveDepthExceededError) {
    return "that coin is already paired against another token, so it can't be used as a pair";
  }
  if (e instanceof QuoteBondingCurveNotEligibleError) {
    return "that coin can't be used as a pool pair";
  }
  if (e instanceof QuoteCurveAwaitingMigrationError) {
    return "that coin just finished its bonding curve and is still migrating — try again in a moment";
  }
  if (e instanceof QuoteReservesOutOfRangeError) {
    return "that coin has too little liquidity to be used as a pair";
  }
  return "that mint is not an accepted pool pair on pump.fun";
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
  /** Set when the quote is a live pump coin — the extra accounts the create needs. */
  pumpQuote?: PumpQuoteAccounts;
}): Promise<string> {
  const instructions: TransactionInstruction[] = [];

  // Token-quoted creates are heavy (create plus the curve's quote ATA, plus a
  // pump coin's own curve/pool); SOL creates are cheap and ride the default
  // budget. A pump-coin quote is the heaviest of the lot, so it gets more room.
  if (opts.quoteMint) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: opts.pumpQuote ? 400_000 : 250_000 }),
    );
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
        ? {
            quoteMint: opts.quoteMint,
            quoteTokenProgram: opts.quoteTokenProgram,
            // A pump coin quoted against: appends its bonding curve (and, once
            // migrated, its pool) so the program can price the new curve.
            ...(opts.pumpQuote ? { pumpQuote: opts.pumpQuote } : {}),
          }
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

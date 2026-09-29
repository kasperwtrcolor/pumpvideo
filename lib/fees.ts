/**
 * In-app trading fees.
 *
 * A buy made through PumpClip pays two fees, both in SOL, both taken on the
 * *buy* only:
 *
 *   - 1% to the clip's creator (the wallet that uploaded the video)
 *   - 2% to the app treasury vault
 *
 * Jupiter's own platform-fee feature can't express this: it pays a single
 * referral account and takes its cut in the *output token*. So instead we take
 * the swap transaction Jupiter built, decompile its v0 message, append two
 * SystemProgram transfers, and recompile. One transaction, one signature,
 * atomic — if the swap reverts the fees never move, and vice versa.
 *
 * The fee payer is the buyer, so the cost of a buy is `amount + 3%`. That makes
 * our in-app price 3% worse than swapping the same coin directly; inherent to
 * taking a cut, and disclosed in the trade sheet.
 */
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

/** App treasury vault. Overridable so a testnet run can't pay mainnet. */
export const TREASURY_VAULT =
  process.env.TREASURY_VAULT?.trim() || "FZ8RRJnQW7MTiQ15EY7AyrSDhACoXNTdsoJ74k2GRPoq";

export const TREASURY_BPS = 200; // 2.00%
export const CREATOR_BPS = 100; // 1.00%

export function isTreasuryConfigured(): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(TREASURY_VAULT).toBytes());
  } catch {
    return false;
  }
}

/** Fee in lamports for a given base amount. Floors, so we never overcharge. */
export function feeLamports(amountLamports: bigint, bps: number): bigint {
  if (amountLamports <= 0n || bps <= 0) return 0n;
  return (amountLamports * BigInt(bps)) / 10_000n;
}

export type FeeSplit = {
  /** lamports to the treasury vault */
  treasury: bigint;
  /** lamports to the clip creator (0 when there is no creator, or it's the vault) */
  creator: bigint;
  /** total fee lamports the buyer pays on top of the swap */
  total: bigint;
  creatorWallet: string | null;
};

export function computeFeeSplit(solInLamports: bigint, creatorWallet: string | null): FeeSplit {
  const treasury = feeLamports(solInLamports, TREASURY_BPS);
  let creator = 0n;
  let creatorOut: string | null = null;

  if (creatorWallet) {
    try {
      const key = new PublicKey(creatorWallet);
      // Paying the vault as "creator" would be two instructions to one account;
      // fold it into the treasury leg instead.
      if (key.toBase58() !== TREASURY_VAULT) {
        creator = feeLamports(solInLamports, CREATOR_BPS);
        creatorOut = key.toBase58();
      }
    } catch {
      // An unparseable creator wallet is treated as "no creator" — the fee falls
      // through to the treasury rather than blocking the trade.
      creatorOut = null;
    }
  }

  // With no creator, the 1% still gets charged — it just goes to the treasury,
  // so a buy is never silently cheaper through a creator-less clip.
  const treasuryFinal = creatorOut ? treasury : treasury + feeLamports(solInLamports, CREATOR_BPS);

  return {
    treasury: treasuryFinal,
    creator,
    total: treasuryFinal + creator,
    creatorWallet: creatorOut,
  };
}

/**
 * Append the fee transfers to a Jupiter swap and return the re-serialised,
 * still-unsigned transaction.
 *
 * The lookup tables the swap uses have to be re-resolved to decompile the
 * message; without them the instruction list comes back incomplete and the
 * recompiled transaction would be missing accounts.
 */
export async function attachFees(opts: {
  transactionBase64: string;
  buyer: PublicKey;
  solInLamports: bigint;
  creatorWallet: string | null;
  connection: Connection;
}): Promise<{ transaction: string; fees: FeeSplit }> {
  const fees = computeFeeSplit(opts.solInLamports, opts.creatorWallet);

  if (fees.total <= 0n) {
    return { transaction: opts.transactionBase64, fees };
  }

  const original = VersionedTransaction.deserialize(
    Buffer.from(opts.transactionBase64, "base64"),
  );

  const lookupTables: AddressLookupTableAccount[] = [];
  for (const lookup of original.message.addressTableLookups) {
    const res = await opts.connection.getAddressLookupTable(lookup.accountKey);
    if (res.value) lookupTables.push(res.value);
  }

  const { instructions } = TransactionMessage.decompile(original.message, {
    addressLookupTableAccounts: lookupTables,
  });

  // NOTE: a deserialised VersionedMessage has no `payerKey` property — for a v0
  // message the fee payer is always the first static account key.
  const payer = original.message.staticAccountKeys[0];

  instructions.push(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: new PublicKey(TREASURY_VAULT),
      lamports: fees.treasury,
    }),
  );

  if (fees.creator > 0n && fees.creatorWallet) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: new PublicKey(fees.creatorWallet),
        lamports: fees.creator,
      }),
    );
  }

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: original.message.recentBlockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const rebuilt = new VersionedTransaction(message);

  let serialized: Buffer;
  try {
    serialized = Buffer.from(rebuilt.serialize());
  } catch {
    // web3.js serialises into a fixed 1232-byte packet buffer and throws when the
    // message no longer fits. Adding our two transfers can tip a very large route
    // over the Solana transaction limit — surface that as a clear, retryable
    // condition instead of an opaque RangeError.
    throw new Error(
      "this route is too large to carry the trading fee (transaction exceeds the 1232-byte Solana limit)",
    );
  }

  return {
    transaction: serialized.toString("base64"),
    fees,
  };
}

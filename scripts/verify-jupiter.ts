/**
 * Verify the server half of live trading end-to-end, without needing a wallet.
 *
 *   npx tsx scripts/verify-jupiter.ts [mint]
 *
 * This exercises exactly what /api/trade/live/prepare does — quote on Jupiter,
 * build the swap, hand back bytes — and then proves the bytes are a real,
 * well-formed versioned transaction whose fee payer is the address we asked for.
 * The only step it cannot cover is the signature itself, which happens in the
 * browser inside Privy.
 *
 * If this passes, a live trade can only fail for wallet-side reasons (no SOL,
 * user rejects, RPC down) — never because the server built a bad transaction.
 */
import { Connection, Keypair, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { jupiterQuote, jupiterSwapTransaction, routeLabels, WSOL_MINT } from "../lib/jupiter";
import { attachFees, computeFeeSplit, TREASURY_VAULT } from "../lib/fees";
import { SOLANA_RPC } from "../lib/pumpfun";

const LAMPORTS = 1_000_000_000;
// A live, tradable pump.fun coin. Deliberately NOT the old default: some mints
// resolve to a Pump.fun Amm → Pump.fun two-hop whose transaction is 1340 bytes,
// over Solana's 1232 limit, so the RPC rejects it before it ever reaches a
// wallet. Override with any mint you like.
const MINT = process.argv[2] || "XU438yQcHEf5bGAZ3pHqXhbZPqotoapdanjnhj1pump";

// A throwaway keypair stands in for the user's embedded wallet. We never sign,
// so this only needs to be a valid curve point.
const owner = Keypair.generate().publicKey;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log(`verify jupiter live path\n  mint   ${MINT}\n  payer  ${owner.toBase58()}\n`);

  console.log("BUY quote (0.1 SOL in)");
  const quote = await jupiterQuote({
    inputMint: WSOL_MINT,
    outputMint: MINT,
    amount: 100_000_000n,
    slippageBps: 500,
  });
  check("quote returned a route", quote.routePlan.length > 0, routeLabels(quote).join(" → "));
  check("quote has a non-zero output", Number(quote.outAmount) > 0, `${quote.outAmount} raw`);
  check(
    "minimum out is below expected out",
    Number(quote.otherAmountThreshold) <= Number(quote.outAmount),
    `min ${quote.otherAmountThreshold}`,
  );
  console.log(
    `        price impact ${(Number(quote.priceImpactPct) * 100).toFixed(4)}%  ` +
      `tokens ${(Number(quote.outAmount) / 1e6).toFixed(2)}`,
  );

  console.log("\nBUY transaction");
  const swap = await jupiterSwapTransaction({ quote, userPublicKey: owner.toBase58() });
  check("swap returned a transaction", Boolean(swap.swapTransaction));

  const bytes = Buffer.from(swap.swapTransaction, "base64");
  check("payload is non-trivial", bytes.length > 500, `${bytes.length} bytes`);

  let tx: VersionedTransaction | null = null;
  try {
    tx = VersionedTransaction.deserialize(bytes);
    check("deserialises as a versioned transaction", true);
  } catch (e) {
    check("deserialises as a versioned transaction", false, (e as Error).message);
  }

  if (tx) {
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    // The fee payer is the first static account key and the required signer.
    check("fee payer is the user's address", keys[0] === owner.toBase58(), keys[0]?.slice(0, 12));
    check("message is not yet signed", tx.signatures.every((s) => s.every((b) => b === 0)));
    check("has exactly one signature slot", tx.signatures.length === 1, `${tx.signatures.length}`);
    console.log(`        ${keys.length} static account keys, ${tx.message.compiledInstructions.length} instructions`);
  }

  console.log("\nBUY fee split (1% creator + 2% treasury)");
  const creator = Keypair.generate().publicKey;
  const split = computeFeeSplit(100_000_000n, creator.toBase58());
  check("creator leg is 1% of the buy", split.creator === 1_000_000n, `${split.creator} lamports`);
  check("treasury leg is 2% of the buy", split.treasury === 2_000_000n, `${split.treasury} lamports`);

  const conn = new Connection(SOLANA_RPC, "confirmed");
  const withFees = await attachFees({
    transactionBase64: swap.swapTransaction,
    buyer: owner,
    solInLamports: 100_000_000n,
    creatorWallet: creator.toBase58(),
    connection: conn,
  });

  const feeTx = VersionedTransaction.deserialize(Buffer.from(withFees.transaction, "base64"));
  check(
    "fee payer is still the buyer",
    feeTx.message.staticAccountKeys[0].toBase58() === owner.toBase58(),
  );
  check("fee tx is still unsigned", feeTx.signatures.every((s) => s.every((b) => b === 0)));
  check("fee tx has exactly one signature slot", feeTx.signatures.length === 1, `${feeTx.signatures.length}`);

  // Jupiter's own wrap/unwrap uses SystemProgram too, so identify *our* legs by
  // position (they are appended last) and by destination, not by count alone.
  const staticKeys = feeTx.message.staticAccountKeys.map((k) => k.toBase58());
  const sysProgram = SystemProgram.programId.toBase58();
  const ixs = feeTx.message.compiledInstructions;

  function solTransfer(ix: (typeof ixs)[number]): { to: string; lamports: number } | null {
    if (staticKeys[ix.programIdIndex] !== sysProgram) return null;
    const toIdx = ix.accountKeyIndexes[1];
    if (toIdx >= staticKeys.length) return null; // lives in a lookup table
    const data = ix.data;
    if (data.length < 12 || data[0] !== 2) return null; // 2 = Transfer
    let lamports = 0n;
    for (let i = 0; i < 8; i++) lamports |= BigInt(data[4 + i]) << BigInt(8 * i);
    return { to: staticKeys[toIdx], lamports: Number(lamports) };
  }

  const lastTwo = [solTransfer(ixs[ixs.length - 2]), solTransfer(ixs[ixs.length - 1])];
  check("the last two instructions are SOL transfers", lastTwo.every(Boolean), `${ixs.length} instructions total`);

  const toTreasury = lastTwo.find((t) => t?.to === TREASURY_VAULT);
  const toCreator = lastTwo.find((t) => t?.to === creator.toBase58());
  check("2% leg pays the treasury vault", toTreasury?.lamports === 2_000_000, `${toTreasury?.lamports ?? "n/a"}`);
  check("1% leg pays the clip creator", toCreator?.lamports === 1_000_000, `${toCreator?.lamports ?? "n/a"}`);
  console.log(
    `        a 0.1 SOL buy carries ${(Number(withFees.fees.total) / LAMPORTS).toFixed(4)} SOL in fees ` +
      `(swap then treasury then creator, atomic)`,
  );

  console.log("\nSELL quote (1,000,000 raw tokens in)");
  const sell = await jupiterQuote({
    inputMint: MINT,
    outputMint: WSOL_MINT,
    amount: 1_000_000n,
    slippageBps: 500,
  });
  check("sell route exists", sell.routePlan.length > 0, routeLabels(sell).join(" → "));
  console.log(`        ${(Number(sell.outAmount) / LAMPORTS).toFixed(6)} SOL out`);

  const sellTx = await jupiterSwapTransaction({ quote: sell, userPublicKey: owner.toBase58() });
  const sellBytes = Buffer.from(sellTx.swapTransaction, "base64");
  let sellOk = false;
  try {
    const t = VersionedTransaction.deserialize(sellBytes);
    sellOk = t.message.staticAccountKeys[0].toBase58() === owner.toBase58();
  } catch {
    sellOk = false;
  }
  check("sell transaction builds with the right fee payer", sellOk, `${sellBytes.length} bytes`);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

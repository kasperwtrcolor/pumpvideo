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
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { jupiterQuote, jupiterSwapTransaction, routeLabels, WSOL_MINT } from "../lib/jupiter";

const LAMPORTS = 1_000_000_000;
const MINT = process.argv[2] || "7AaikLQoMLQhxGto9nr9iN5SWkPdLq3Daa87svehpump";

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

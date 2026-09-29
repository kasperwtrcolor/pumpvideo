import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { privyConfigured, traderFromAuthHeader } from "@/lib/privy";
import { clientKey, rateLimit } from "@/lib/ratelimit";
import {
  JupiterError,
  WSOL_MINT,
  jupiterQuote,
  jupiterSwapTransaction,
  routeLabels,
} from "@/lib/jupiter";

export const dynamic = "force-dynamic";

/**
 * POST /api/trade/live/prepare
 * Authorization: Bearer *** access token>
 * body: { mint, side: "BUY", solAmount } | { mint, side: "SELL", fraction }
 *
 * Step 1 of 3 for a real fill:
 *   1. (here) quote on Jupiter and return an UNSIGNED transaction
 *   2. (browser) Privy signs and sends it
 *   3. POST /api/trade/live/confirm records the signature
 *
 * This handler never sees a private key. It validates against the caller's
 * verified Privy identity, builds the swap for their *public* address, and
 * returns bytes.
 */

const Body = z.discriminatedUnion("side", [
  z.object({
    mint: z.string().min(32).max(48),
    side: z.literal("BUY"),
    solAmount: z.number().positive().max(50),
    slippageBps: z.number().int().min(10).max(3000).default(500),
  }),
  z.object({
    mint: z.string().min(32).max(48),
    side: z.literal("SELL"),
    fraction: z.number().positive().max(1),
    slippageBps: z.number().int().min(10).max(3000).default(500),
  }),
]);

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Spend large enough to clear fees but small enough to survive a fresh wallet. */
const MIN_BUY_LAMPORTS = 1_000_000; // 0.001 SOL

export async function POST(req: NextRequest) {
  if (!privyConfigured()) {
    return NextResponse.json({ error: "PRIVY_NOT_CONFIGURED" }, { status: 503 });
  }

  const limit = rateLimit(`live:${clientKey(req)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", detail: "too many trade preparations" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  let trader;
  try {
    trader = await traderFromAuthHeader(req);
  } catch {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
  }
  if (!trader) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED", detail: "log in first" }, { status: 401 });
  }
  if (!trader.walletAddress) {
    return NextResponse.json(
      { error: "NO_WALLET", detail: "no wallet is attached to this account" },
      { status: 409 },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  const owner = new PublicKey(trader.walletAddress);

  // Validate the mint up front — zod only checks the shape, not that it's a
  // real base58 public key. Doing it here means the sell path can't fail later
  // with a confusing RPC error.
  let mintKey: PublicKey;
  try {
    mintKey = new PublicKey(parsed.mint);
  } catch {
    return NextResponse.json(
      { error: "BAD_MINT", detail: "not a valid Solana mint address" },
      { status: 400 },
    );
  }

  // ---- resolve the input side of the swap -------------------------------
  let inputMint: string;
  let outputMint: string;
  let amount: bigint;
  let sellBalanceRaw: bigint | null = null;

  if (parsed.side === "BUY") {
    inputMint = WSOL_MINT;
    outputMint = parsed.mint;
    amount = BigInt(Math.floor(parsed.solAmount * LAMPORTS_PER_SOL));
    if (amount < BigInt(MIN_BUY_LAMPORTS)) {
      return NextResponse.json(
        { error: "AMOUNT_TOO_SMALL", detail: "minimum buy is 0.001 SOL" },
        { status: 400 },
      );
    }
  } else {
    // Selling: the authoritative amount is what the wallet actually holds,
    // not our Position row — live tokens may never have been recorded.
    inputMint = parsed.mint;
    outputMint = WSOL_MINT;
    try {
      const conn = new Connection(SOLANA_RPC, "confirmed");
      const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: mintKey });
      let held = 0n;
      for (const acc of res.value) {
        const amt = (acc.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } })
          .parsed?.info?.tokenAmount?.amount;
        if (amt) held += BigInt(amt);
      }
      sellBalanceRaw = held;
      if (held <= 0n) {
        return NextResponse.json(
          { error: "NO_POSITION", detail: "this wallet holds none of that token" },
          { status: 400 },
        );
      }
      amount = parsed.fraction === 1 ? held : (held * BigInt(Math.round(parsed.fraction * 10_000))) / 10_000n;
      if (amount <= 0n) {
        return NextResponse.json({ error: "AMOUNT_TOO_SMALL" }, { status: 400 });
      }
    } catch (e) {
      return NextResponse.json(
        { error: "RPC_UNAVAILABLE", detail: (e as Error).message },
        { status: 502 },
      );
    }
  }

  // ---- quote + build -----------------------------------------------------
  let quote;
  let swap;
  try {
    quote = await jupiterQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: parsed.slippageBps,
    });
    swap = await jupiterSwapTransaction({ quote, userPublicKey: owner.toBase58() });
  } catch (e) {
    if (e instanceof JupiterError) {
      const status = e.code === "NO_ROUTE" ? 422 : 502;
      return NextResponse.json({ error: e.code, detail: e.message }, { status });
    }
    console.error("[live-prepare]", e);
    return NextResponse.json({ error: "INTERNAL", detail: "could not build the swap" }, { status: 500 });
  }

  const inAmount = Number(quote.inAmount);
  const outAmount = Number(quote.outAmount);
  const minOut = Number(quote.otherAmountThreshold);
  const labels = routeLabels(quote);

  return NextResponse.json({
    ok: true,
    side: parsed.side,
    mint: parsed.mint,
    // Unsigned, base64. Jupiter's bytes verbatim — the browser signs exactly this.
    transaction: swap.swapTransaction,
    lastValidBlockHeight: swap.lastValidBlockHeight ?? null,
    slippageBps: quote.slippageBps,
    priceImpactPct: Number(quote.priceImpactPct),
    route: labels,
    // Human-readable expectations, per side.
    inputAmountRaw: quote.inAmount,
    outputAmountRaw: quote.outAmount,
    minOutputAmountRaw: quote.otherAmountThreshold,
    // BUY: SOL in, tokens out. SELL: tokens in, SOL out.
    expectedTokens: parsed.side === "BUY" ? outAmount / 1e6 : undefined,
    minTokens: parsed.side === "BUY" ? minOut / 1e6 : undefined,
    expectedSol: parsed.side === "SELL" ? outAmount / LAMPORTS_PER_SOL : undefined,
    minSol: parsed.side === "SELL" ? minOut / LAMPORTS_PER_SOL : undefined,
    solIn: parsed.side === "BUY" ? inAmount / LAMPORTS_PER_SOL : undefined,
    sellBalanceRaw: sellBalanceRaw?.toString() ?? null,
  });
}

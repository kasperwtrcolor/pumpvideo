import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Connection, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { privyConfigured, traderFromAuthHeader } from "@/lib/privy";
import { clientKey, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Base fee for a single-signature system transfer. */
const BASE_FEE_LAMPORTS = 5_000;
/**
 * A Solana account must hold either 0 lamports or at least the rent-exempt
 * minimum. Leaving a nonzero balance under this floor makes the transfer fail
 * with an opaque "insufficient funds for rent" error, so we check it up front.
 */
const RENT_EXEMPT_MIN_LAMPORTS = 890_880;
const MIN_WITHDRAW_LAMPORTS = 1_000_000; // 0.001 SOL — below this, fees dominate.

/**
 * POST /api/wallet/withdraw
 * Authorization: Bearer <privy access token>
 * body: { to: string, amountSol: number }
 *
 * Prepares (does not execute) a SOL transfer out of the caller's wallet.
 *
 * This endpoint deliberately never touches a private key. It validates the
 * request against the caller's *verified* Privy identity, then hands back the
 * parameters the browser needs to build the transaction and have the embedded
 * wallet sign it locally. Key material stays inside Privy's iframe; the server
 * only ever sees a public address.
 */
export async function POST(req: NextRequest) {
  if (!privyConfigured()) {
    return NextResponse.json({ error: "PRIVY_NOT_CONFIGURED" }, { status: 503 });
  }

  const limit = rateLimit(`wd:${clientKey(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", detail: "too many withdrawal attempts" },
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
    return NextResponse.json(
      { error: "NOT_AUTHENTICATED", detail: "log in first" },
      { status: 401 },
    );
  }
  if (!trader.walletAddress) {
    return NextResponse.json(
      { error: "NO_WALLET", detail: "no wallet is attached to this account" },
      { status: 409 },
    );
  }

  let body: { to?: string; amountSol?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  const rawTo = body.to?.trim();
  if (!rawTo) return NextResponse.json({ error: "MISSING_DESTINATION" }, { status: 400 });

  let toPubkey: PublicKey;
  try {
    toPubkey = new PublicKey(rawTo);
    if (!PublicKey.isOnCurve(toPubkey.toBytes())) throw new Error("off curve");
  } catch {
    return NextResponse.json(
      { error: "BAD_DESTINATION", detail: "not a valid Solana wallet address" },
      { status: 400 },
    );
  }

  const from = new PublicKey(trader.walletAddress);
  if (toPubkey.equals(from)) {
    return NextResponse.json(
      { error: "SELF_TRANSFER", detail: "destination is the wallet itself" },
      { status: 400 },
    );
  }

  const amountSol = Number(body.amountSol);
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    return NextResponse.json({ error: "BAD_AMOUNT" }, { status: 400 });
  }
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (lamports < MIN_WITHDRAW_LAMPORTS) {
    return NextResponse.json(
      { error: "AMOUNT_TOO_SMALL", detail: "minimum withdrawal is 0.001 SOL" },
      { status: 400 },
    );
  }

  let balance: number;
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    const conn = new Connection(SOLANA_RPC, "confirmed");
    balance = await conn.getBalance(from);
    const latest = await conn.getLatestBlockhash("confirmed");
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
  } catch {
    return NextResponse.json({ error: "RPC_UNAVAILABLE" }, { status: 502 });
  }

  const required = lamports + BASE_FEE_LAMPORTS;
  if (required > balance) {
    return NextResponse.json(
      {
        error: "INSUFFICIENT_FUNDS",
        detail: `balance is ${balance / LAMPORTS_PER_SOL} SOL`,
        balanceLamports: balance,
      },
      { status: 400 },
    );
  }

  // Would this strand a sub-rent-exempt remainder behind?
  const remainder = balance - required;
  if (remainder > 0 && remainder < RENT_EXEMPT_MIN_LAMPORTS) {
    return NextResponse.json(
      {
        error: "DUST_REMAINDER",
        detail: `that would leave ${remainder} lamports, below the rent-exempt minimum. Withdraw all ${(
          (balance - BASE_FEE_LAMPORTS) /
          LAMPORTS_PER_SOL
        ).toFixed(6)} SOL instead, or leave at least 0.00089088 SOL.`,
        balanceLamports: balance,
        maxWithdrawableSol: (balance - BASE_FEE_LAMPORTS) / LAMPORTS_PER_SOL,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    from: trader.walletAddress,
    to: toPubkey.toBase58(),
    lamports,
    feeLamports: BASE_FEE_LAMPORTS,
    balanceLamports: balance,
    blockhash,
    lastValidBlockHeight,
    // Lets the client build the exact same instruction without importing
    // program ids of its own.
    programId: SystemProgram.programId.toBase58(),
  });
}
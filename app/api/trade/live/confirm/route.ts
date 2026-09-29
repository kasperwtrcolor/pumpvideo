import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Connection, SystemProgram } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { TREASURY_VAULT } from "@/lib/fees";
import { privyConfigured, traderFromAuthHeader } from "@/lib/privy";
import { clientKey, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/trade/live/confirm
 * Authorization: Bearer *** access token>
 * body: { mint, side, signature }
 *
 * Step 3 of 3. We do not take the browser's word that a swap happened: the
 * signature is looked up on-chain, the transaction must have succeeded, and the
 * fee payer must be this trader's own wallet. Amounts are read from the
 * transaction's own balance deltas rather than from the request body, so the
 * recorded trade is what the chain says, not what the client claims.
 */

const Body = z.object({
  mint: z.string().min(32).max(48),
  side: z.enum(["BUY", "SELL"]),
  signature: z.string().min(60).max(100),
  /// The clip the buyer came through. Used only to identify which creator's
  /// 1% leg to look for in the transaction — never trusted for the amount.
  clipId: z.string().min(1).max(64).optional(),
});

const LAMPORTS_PER_SOL = 1_000_000_000;

type TokenBalance = {
  owner?: string;
  mint: string;
  uiTokenAmount: { amount: string; decimals: number };
};

export async function POST(req: NextRequest) {
  if (!privyConfigured()) {
    return NextResponse.json({ error: "PRIVY_NOT_CONFIGURED" }, { status: 503 });
  }

  const limit = rateLimit(`confirm:${clientKey(req)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", detail: "too many confirmations" },
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
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }
  if (!trader.walletAddress) {
    return NextResponse.json({ error: "NO_WALLET" }, { status: 409 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "BAD_BODY", detail: (e as Error).message }, { status: 400 });
  }

  const { mint, side, signature, clipId } = parsed;

  // Replay guard: a signature can only ever back one trade row.
  const already = await prisma.trade.findFirst({ where: { txSig: signature } });
  if (already) {
    return NextResponse.json({ error: "ALREADY_RECORDED", tradeId: already.id }, { status: 409 });
  }

  const coin = await prisma.coin.findUnique({ where: { mint } });
  if (!coin) return NextResponse.json({ error: "NO_COIN" }, { status: 404 });

  // ---- verify on chain ---------------------------------------------------
  const conn = new Connection(SOLANA_RPC, "confirmed");
  type RawTx = Awaited<ReturnType<Connection["getTransaction"]>>;
  let tx: RawTx = null;
  // The client may report a signature a moment before it's indexed.
  for (let attempt = 0; attempt < 5 && !tx; attempt++) {
    try {
      tx = await conn.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch {
      /* transient — retry */
    }
    if (!tx) await new Promise((r) => setTimeout(r, 1200));
  }

  if (!tx) {
    return NextResponse.json(
      { error: "TX_NOT_FOUND", detail: "that transaction is not confirmed on Solana yet" },
      { status: 404 },
    );
  }
  if (tx.meta?.err) {
    return NextResponse.json(
      { error: "TX_FAILED", detail: `transaction failed on chain: ${JSON.stringify(tx.meta.err)}` },
      { status: 400 },
    );
  }

  // The signer must be this trader — otherwise anyone could log someone else's
  // swap against their own account.
  const signers = tx.transaction.message.staticAccountKeys
    .slice(0, tx.transaction.message.header.numRequiredSignatures)
    .map((k) => k.toBase58());
  if (!signers.includes(trader.walletAddress)) {
    return NextResponse.json(
      { error: "WRONG_SIGNER", detail: "this transaction was not signed by your wallet" },
      { status: 403 },
    );
  }

  // ---- read the real amounts off the transaction -------------------------
  const meta = tx.meta!;
  const keys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
  const walletIdx = keys.indexOf(trader.walletAddress);

  let solDeltaLamports = 0n;
  if (walletIdx >= 0 && meta.preBalances[walletIdx] != null && meta.postBalances[walletIdx] != null) {
    solDeltaLamports = BigInt(meta.postBalances[walletIdx] - meta.preBalances[walletIdx]);
  }

  const tokenDelta = (list: TokenBalance[] | null | undefined) => {
    let sum = 0n;
    for (const b of list ?? []) {
      if (b.mint === mint && b.owner === trader.walletAddress) {
        sum += BigInt(b.uiTokenAmount.amount);
      }
    }
    return sum;
  };
  const preTok = tokenDelta(meta.preTokenBalances as TokenBalance[] | null);
  const postTok = tokenDelta(meta.postTokenBalances as TokenBalance[] | null);
  const tokDelta = postTok - preTok;

  const decimals = (meta.postTokenBalances as TokenBalance[] | null)?.find((b) => b.mint === mint)
    ?.uiTokenAmount.decimals;

  // BUY: SOL goes out (negative delta), tokens come in (positive).
  const solAmount = Number(solDeltaLamports < 0n ? -solDeltaLamports : solDeltaLamports) / LAMPORTS_PER_SOL;
  const tokenAmount = (tokDelta < 0n ? -tokDelta : tokDelta).toString();
  const priceSol =
    tokDelta !== 0n
      ? solAmount / (Number(tokDelta < 0n ? -tokDelta : tokDelta) / 10 ** (decimals ?? 6))
      : 0;

  // ---- read the in-app fee off the transaction ---------------------------
  // We appended the fee as plain SystemProgram transfers, so they are the last
  // instructions and their destinations are static keys. Summing what actually
  // moved to the vault and to the creator is a fact; the request body is not.
  const creatorWallet = clipId
    ? (await prisma.clip.findUnique({ where: { id: clipId }, select: { creatorWallet: true } }))
        ?.creatorWallet ?? null
    : null;

  const staticKeys = keys;
  const sysProgram = SystemProgram.programId.toBase58();
  const transferLamports = (to: string): bigint => {
    let sum = 0n;
    for (const ix of tx!.transaction.message.compiledInstructions) {
      if (staticKeys[ix.programIdIndex] !== sysProgram) continue;
      const toIdx = ix.accountKeyIndexes[1];
      if (toIdx == null || toIdx >= staticKeys.length) continue;
      if (staticKeys[toIdx] !== to) continue;
      const data = ix.data;
      if (data.length < 12 || data[0] !== 2) continue; // 2 = System Transfer
      let lamports = 0n;
      for (let i = 0; i < 8; i++) lamports |= BigInt(data[4 + i]) << BigInt(8 * i);
      sum += lamports;
    }
    return sum;
  };

  const treasuryFeeSol = side === "BUY" ? Number(transferLamports(TREASURY_VAULT)) / LAMPORTS_PER_SOL : 0;
  const creatorFeeSol =
    side === "BUY" && creatorWallet && creatorWallet !== TREASURY_VAULT
      ? Number(transferLamports(creatorWallet)) / LAMPORTS_PER_SOL
      : 0;
  const inAppFeeSol = treasuryFeeSol + creatorFeeSol;

  const tokenRaw = tokDelta < 0n ? -tokDelta : tokDelta;
  const tokenUi = Number(tokenRaw) / 10 ** (decimals ?? 6);

  const trade = await prisma.trade.create({
    data: {
      traderId: trader.id,
      coinMint: mint,
      symbol: coin.symbol,
      side,
      mode: "LIVE",
      solAmount,
      tokenAmount: tokenRaw.toString(),
      priceSol,
      feeSol: inAppFeeSol,
      txSig: signature,
    },
  });

  // ---- keep the position mirror in step with the wallet -------------------
  const existing = await prisma.position.findUnique({
    where: { traderId_coinId: { traderId: trader.id, coinId: coin.id } },
  });
  const heldBefore = BigInt(existing?.tokenAmount ?? "0");
  const heldAfter = side === "BUY" ? heldBefore + tokenRaw : heldBefore - tokenRaw;

  if (heldAfter <= 0n && side === "SELL") {
    // Fully exited. Keep the row but zero it so realized PnL survives.
    await prisma.position.upsert({
      where: { traderId_coinId: { traderId: trader.id, coinId: coin.id } },
      create: {
        traderId: trader.id,
        coinId: coin.id,
        tokenAmount: "0",
        costSol: 0,
        realizedSol: solAmount,
      },
      update: {
        tokenAmount: "0",
        costSol: 0,
        realizedSol: { increment: solAmount },
      },
    });
  } else {
    await prisma.position.upsert({
      where: { traderId_coinId: { traderId: trader.id, coinId: coin.id } },
      create: {
        traderId: trader.id,
        coinId: coin.id,
        tokenAmount: heldAfter.toString(),
        costSol: side === "BUY" ? solAmount : 0,
      },
      update: {
        tokenAmount: heldAfter.toString(),
        ...(side === "BUY" ? { costSol: { increment: solAmount } } : {}),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    tradeId: trade.id,
    symbol: coin.symbol,
    side,
    solAmount,
    tokenAmount: tokenUi,
    priceSol,
    feeSol: inAppFeeSol,
    feeBreakdown: { treasurySol: treasuryFeeSol, creatorSol: creatorFeeSol, creatorWallet },
    signature,
    explorer: `https://explorer.solana.com/tx/${signature}`,
  });
}

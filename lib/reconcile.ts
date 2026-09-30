/**
 * Reconcile stored positions against the wallet's real on-chain balance.
 *
 * The position table is a *mirror* of what each wallet holds. Keeping it by
 * adding and subtracting our own fill log is not enough: the wallet can move
 * without the app — a swap on pump.fun directly, a transfer out, an account
 * sweep — and because the mirror is arithmetic on our own history, that drift
 * is permanent. The symptom is a bag that will not go away: the wallet is
 * empty, the app still lists the position, still marks it, still offers to sell
 * it.
 *
 * Reading the chain and overwriting the stored holding fixes it, and it fixes
 * it for anyone, whether or not they ever trade through the app again. The live
 * confirm route now reconciles on every fill; this is the same repair applied
 * on a schedule, so a wallet that never comes back still gets corrected.
 *
 * Cost basis is scaled by the same ratio, which is what average-cost accounting
 * does when the quantity changes underneath it. A holding that has gone to zero
 * takes its basis with it.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { prisma } from "./db";
import { SOLANA_RPC } from "./pumpfun";

export type ReconcileResult = {
  checked: number;
  drifted: number;
  written: number;
  failed: number;
};

/** Raw token units held on chain, summed across the wallet's accounts. */
async function chainBalance(conn: Connection, wallet: string, mint: string): Promise<bigint> {
  const accounts = await conn.getParsedTokenAccountsByOwner(new PublicKey(wallet), {
    mint: new PublicKey(mint),
  });
  let total = 0n;
  for (const a of accounts.value) {
    const info = a.account.data as {
      parsed?: { info?: { tokenAmount?: { amount?: string } } };
    };
    total += BigInt(info?.parsed?.info?.tokenAmount?.amount ?? "0");
  }
  return total;
}

/**
 * @param apply  false to report only. The keeper always applies; the CLI
 *               defaults to a dry run so a repair is never a surprise.
 * @param limit  Cap on rows examined per run, so a scheduled pass cannot turn
 *               into hundreds of RPC calls in one tick.
 */
export async function reconcilePositions({
  apply,
  limit = 50,
}: {
  apply: boolean;
  limit?: number;
}): Promise<ReconcileResult> {
  const conn = new Connection(SOLANA_RPC, "confirmed");

  const positions = await prisma.position.findMany({
    where: { tokenAmount: { not: "0" } },
    include: {
      trader: { select: { walletAddress: true } },
      coin: { select: { mint: true, symbol: true } },
    },
    take: limit,
  });

  const out: ReconcileResult = { checked: 0, drifted: 0, written: 0, failed: 0 };

  for (const p of positions) {
    const wallet = p.trader.walletAddress;
    if (!wallet) continue;
    out.checked++;

    let chain: bigint;
    try {
      chain = await chainBalance(conn, wallet, p.coin.mint);
    } catch {
      // A flaky RPC must never be read as "the wallet is empty" — that would
      // delete a real position. Skip and let the next tick try again.
      out.failed++;
      continue;
    }

    const stored = BigInt(p.tokenAmount);
    if (chain === stored) continue;
    out.drifted++;

    const basisAfter = chain === 0n ? 0 : p.costSol * (Number(chain) / Number(stored || 1n));

    if (apply) {
      await prisma.position.update({
        where: { id: p.id },
        data: { tokenAmount: chain.toString(), costSol: Math.max(0, basisAfter) },
      });
      out.written++;
    }
  }

  return out;
}

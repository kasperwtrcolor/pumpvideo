import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  quoteBuy,
  quoteSell,
  solToLamports,
  uiTokensToRaw,
  rawTokensToUi,
  lamportsToSol,
} from "./bonding-curve";

export type TradeMode = "PRACTICE" | "LIVE";

/**
 * Practice trading engine.
 *
 * Fills are priced off the coin's *current on-chain reserves* (synced from pump.fun),
 * using the real constant-product curve + 1% fee. We then write the post-trade
 * reserves back to the DB so a wave of buys actually moves the price for the next
 * viewer — the same feedback loop the real product has, without spending SOL.
 *
 * Live mode deliberately reuses this exact interface: `executeLiveFill` below is the
 * single seam you replace with a pump.fun program call once a wallet is funded.
 */

export class TradeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export async function executePracticeBuy(opts: {
  traderId: string;
  mint: string;
  solAmount: number;
}) {
  const { traderId, mint, solAmount } = opts;
  if (!(solAmount > 0)) throw new TradeError("solAmount must be > 0", "BAD_AMOUNT");

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const coin = await tx.coin.findUnique({ where: { mint } });
    if (!coin) throw new TradeError("unknown mint", "NO_COIN");

    const trader = await tx.trader.findUnique({ where: { id: traderId } });
    if (!trader) throw new TradeError("unknown trader", "NO_TRADER");
    if (trader.practiceBalance < solAmount) {
      throw new TradeError(
        `insufficient practice balance (${trader.practiceBalance.toFixed(3)} SOL)`,
        "INSUFFICIENT_FUNDS",
      );
    }
    if (coin.complete) {
      // Graduated coins trade on an AMM, not the curve. Out of scope for the MVP.
      throw new TradeError("coin graduated to AMM — curve trading disabled", "GRADUATED");
    }

    const vSol = BigInt(coin.virtualSol);
    const vTok = BigInt(coin.virtualToken);
    const fill = quoteBuy(vSol, vTok, solToLamports(solAmount));

    const existing = await tx.position.findUnique({
      where: { traderId_coinId: { traderId, coinId: coin.id } },
    });
    await tx.position.upsert({
      where: { traderId_coinId: { traderId, coinId: coin.id } },
      create: {
        traderId,
        coinId: coin.id,
        tokenAmount: fill.tokenAmount.toString(),
        costSol: solAmount,
      },
      update: {
        tokenAmount: (
          BigInt(existing?.tokenAmount ?? "0") + fill.tokenAmount
        ).toString(),
        costSol: { increment: solAmount },
      },
    });

    await tx.trader.update({
      where: { id: traderId },
      data: { practiceBalance: { decrement: solAmount } },
    });

    // Push the curve forward.
    const newPrice =
      Number(fill.newVirtualSol) / 1e9 / (Number(fill.newVirtualToken) / 1e6);
    const supply = Number(BigInt(coin.totalSupply)) / 1e6;
    await tx.coin.update({
      where: { id: coin.id },
      data: {
        virtualSol: fill.newVirtualSol.toString(),
        virtualToken: fill.newVirtualToken.toString(),
        priceSol: newPrice,
        marketCapSol: newPrice * supply,
      },
    });

    const trade = await tx.trade.create({
      data: {
        traderId,
        coinMint: mint,
        symbol: coin.symbol,
        side: "BUY",
        mode: "PRACTICE",
        solAmount,
        tokenAmount: fill.tokenAmount.toString(),
        priceSol: fill.priceSol,
        feeSol: lamportsToSol(fill.feeSol),
      },
    });

    return {
      trade,
      tokensOut: rawTokensToUi(fill.tokenAmount),
      priceSol: fill.priceSol,
      feeSol: lamportsToSol(fill.feeSol),
      slippagePct: fill.slippagePct,
    };
  });
}

export async function executePracticeSell(opts: {
  traderId: string;
  mint: string;
  /** fraction of the position to sell, 0..1 (1 = all) */
  fraction: number;
}) {
  const { traderId, mint, fraction } = opts;
  if (!(fraction > 0 && fraction <= 1)) {
    throw new TradeError("fraction must be in (0, 1]", "BAD_AMOUNT");
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const coin = await tx.coin.findUnique({ where: { mint } });
    if (!coin) throw new TradeError("unknown mint", "NO_COIN");
    if (coin.complete) throw new TradeError("coin graduated to AMM", "GRADUATED");

    const position = await tx.position.findUnique({
      where: { traderId_coinId: { traderId, coinId: coin.id } },
    });
    if (!position || BigInt(position.tokenAmount) <= 0n) {
      throw new TradeError("nothing to sell", "NO_POSITION");
    }

    const held = BigInt(position.tokenAmount);
    const tokenIn = fraction === 1 ? held : uiTokensToRaw(rawTokensToUi(held) * fraction);
    if (tokenIn <= 0n) throw new TradeError("dust amount", "BAD_AMOUNT");

    const vSol = BigInt(coin.virtualSol);
    const vTok = BigInt(coin.virtualToken);
    const fill = quoteSell(vSol, vTok, tokenIn);

    const remaining = held - tokenIn;
    const solOut = lamportsToSol(fill.solAmount);

    if (remaining === 0n) {
      await tx.position.delete({ where: { id: position.id } });
    } else {
      await tx.position.update({
        where: { id: position.id },
        data: {
          tokenAmount: remaining.toString(),
          costSol: { decrement: position.costSol * fraction },
          realizedSol: { increment: solOut },
        },
      });
    }

    await tx.trader.update({
      where: { id: traderId },
      data: { practiceBalance: { increment: solOut } },
    });

    const newPrice =
      Number(fill.newVirtualSol) / 1e9 / (Number(fill.newVirtualToken) / 1e6);
    const supply = Number(BigInt(coin.totalSupply)) / 1e6;
    await tx.coin.update({
      where: { id: coin.id },
      data: {
        virtualSol: fill.newVirtualSol.toString(),
        virtualToken: fill.newVirtualToken.toString(),
        priceSol: newPrice,
        marketCapSol: newPrice * supply,
      },
    });

    const trade = await tx.trade.create({
      data: {
        traderId,
        coinMint: mint,
        symbol: coin.symbol,
        side: "SELL",
        mode: "PRACTICE",
        solAmount: solOut,
        tokenAmount: tokenIn.toString(),
        priceSol: fill.priceSol,
        feeSol: lamportsToSol(fill.feeSol),
      },
    });

    return {
      trade,
      tokensIn: rawTokensToUi(tokenIn),
      solOut,
      priceSol: fill.priceSol,
      slippagePct: fill.slippagePct,
    };
  });
}

/**
 * LIVE MODE SEAM.
 *
 * The signature intentionally matches the practice path so the UI needs no
 * branching. Implement it by building a pump.fun `buy`/`sell` instruction with
 * @pump-fun/pump-sdk, signing with the connected wallet, and returning the tx
 * signature. Until then the API returns 501 so nothing silently pretends to fill.
 */
export async function executeLiveFill(): Promise<never> {
  throw new TradeError(
    "Live trading is not wired yet — connect a funded wallet and implement executeLiveFill()",
    "LIVE_NOT_IMPLEMENTED",
  );
}

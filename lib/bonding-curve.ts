/**
 * pump.fun bonding-curve math.
 *
 * The curve is a constant product market maker over *virtual* reserves:
 *   k = virtualSolReserves * virtualTokenReserves
 * Buy  : solIn added to virtualSol -> tokensOut = vTok - k / (vSol + solIn)
 * Sell : tokensIn added to virtualTok -> solOut  = vSol - k / (vTok + tokensIn)
 *
 * All reserve quantities are raw integers held as strings (bigint-safe).
 *  - SOL reserves are in lamports (9 decimals)
 *  - token reserves are raw units (6 decimals)
 */

export const SOL_DECIMALS = 9;
export const TOKEN_DECIMALS = 6;

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const TOKENS_PER_UNIT = 1_000_000n;

/** pump.fun takes 1% on the bonding curve. */
export const TRADE_FEE_BPS = 100n;
export const BPS = 10_000n;

export function k(vSol: bigint, vTok: bigint): bigint {
  return vSol * vTok;
}

/** SOL (float, whole units) price of one whole token. */
export function priceSolFromReserves(vSol: bigint, vTok: bigint): number {
  if (vTok === 0n) return 0;
  // (vSol / 1e9) / (vTok / 1e6)
  return Number(vSol) / Number(LAMPORTS_PER_SOL) / (Number(vTok) / Number(TOKENS_PER_UNIT));
}

/** Market cap in SOL from reserves + total supply. */
export function marketCapSolFromReserves(
  vSol: bigint,
  vTok: bigint,
  totalSupply: bigint,
): number {
  const price = priceSolFromReserves(vSol, vTok);
  const supply = Number(totalSupply) / Number(TOKENS_PER_UNIT);
  return price * supply;
}

export type Fill = {
  /** raw token units out/in */
  tokenAmount: bigint;
  /** lamports moved */
  solAmount: bigint;
  /** lamports taken as fee */
  feeSol: bigint;
  /** effective price (SOL per whole token) */
  priceSol: number;
  /** raw reserves after the fill */
  newVirtualSol: bigint;
  newVirtualToken: bigint;
  /** human-readable slippage vs the pre-trade spot price */
  slippagePct: number;
};

/**
 * Quote a buy. `solInLamports` is the amount the user wants to *spend*, gross of fee —
 * the fee is taken off the top, the remainder hits the curve (matches pump.fun UX).
 */
export function quoteBuy(
  vSol: bigint,
  vTok: bigint,
  solInLamports: bigint,
): Fill {
  if (solInLamports <= 0n || vSol <= 0n || vTok <= 0n) {
    throw new Error("invalid buy args");
  }
  const fee = (solInLamports * TRADE_FEE_BPS) / BPS;
  const net = solInLamports - fee;

  const spotBefore = priceSolFromReserves(vSol, vTok);

  const newVirtualSol = vSol + net;
  const newVirtualToken = k(vSol, vTok) / newVirtualSol;
  const tokenAmount = vTok - newVirtualToken;

  const priceSol =
    Number(net) / Number(LAMPORTS_PER_SOL) /
    (Number(tokenAmount) / Number(TOKENS_PER_UNIT));

  return {
    tokenAmount,
    solAmount: solInLamports,
    feeSol: fee,
    priceSol,
    newVirtualSol,
    newVirtualToken,
    slippagePct: spotBefore > 0 ? ((priceSol - spotBefore) / spotBefore) * 100 : 0,
  };
}

/**
 * Quote a sell of `tokenIn` raw units. Returns SOL out net of fee.
 */
export function quoteSell(
  vSol: bigint,
  vTok: bigint,
  tokenIn: bigint,
): Fill {
  if (tokenIn <= 0n || vSol <= 0n || vTok <= 0n) {
    throw new Error("invalid sell args");
  }
  const spotBefore = priceSolFromReserves(vSol, vTok);

  const newVirtualToken = vTok + tokenIn;
  const newVirtualSol = k(vSol, vTok) / newVirtualToken;
  const gross = vSol - newVirtualSol;
  const fee = (gross * TRADE_FEE_BPS) / BPS;
  const net = gross - fee;

  const priceSol =
    Number(net) / Number(LAMPORTS_PER_SOL) /
    (Number(tokenIn) / Number(TOKENS_PER_UNIT));

  return {
    tokenAmount: tokenIn,
    solAmount: net,
    feeSol: fee,
    priceSol,
    newVirtualSol: vSol - gross,
    newVirtualToken,
    slippagePct: spotBefore > 0 ? ((priceSol - spotBefore) / spotBefore) * 100 : 0,
  };
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL)));
}

export function lamportsToSol(lamports: bigint | string): number {
  return Number(BigInt(lamports)) / Number(LAMPORTS_PER_SOL);
}

export function rawTokensToUi(raw: bigint | string): number {
  return Number(BigInt(raw)) / Number(TOKENS_PER_UNIT);
}

export function uiTokensToRaw(ui: number): bigint {
  return BigInt(Math.round(ui * Number(TOKENS_PER_UNIT)));
}

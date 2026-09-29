/**
 * App-wide capability switches.
 *
 * These describe what the *app* can do, as opposed to what a given viewer has
 * set up. Keeping them separate is what stops the UI from announcing "LIVE"
 * just because someone has a wallet connected.
 */

/**
 * Whether real on-chain buys/sells are wired up.
 *
 * Live fills now execute for real: the client asks /api/trade/live/prepare for
 * an unsigned Jupiter swap, signs it with the embedded Privy wallet, and
 * /api/trade/live/confirm verifies the signature on chain before recording it.
 * The flag stays overridable so the app can be pinned to practice-only (set
 * LIVE_TRADING_ENABLED=false) without a redeploy of anything else.
 */
export function liveTradingEnabled(): boolean {
  return process.env.LIVE_TRADING_ENABLED !== "false";
}

/** Whether the Privy app id is present, i.e. whether login can be offered. */
export function privyAppId(): string | null {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;
}

export function privyConfigured(): boolean {
  return Boolean(privyAppId());
}

/** Public RPC used for read-only balance checks in the browser. */
export function publicSolanaRpc(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";
}
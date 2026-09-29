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
 * `executeLiveFill()` in the trade route is still a deliberate 501 stub, so this
 * defaults to false and the UI stays honest about practice-only trading. Flip
 * the env var once live fills actually execute.
 */
export function liveTradingEnabled(): boolean {
  return process.env.LIVE_TRADING_ENABLED === "true";
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
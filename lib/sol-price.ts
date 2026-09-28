let cached: { usd: number; at: number } | null = null;
const TTL = 60_000;

const FALLBACK_SOL_USD = 150;

/** Live SOL/USD with a 60s cache. Binance primary, CoinGecko backup, constant last resort. */
export async function solUsd(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL) return cached.usd;

  const sources: Array<() => Promise<number>> = [
    async () => {
      const r = await fetch(
        "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
        { cache: "no-store", signal: AbortSignal.timeout(4000) },
      );
      const j = (await r.json()) as { price: string };
      return Number(j.price);
    },
    async () => {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { cache: "no-store", signal: AbortSignal.timeout(4000) },
      );
      const j = (await r.json()) as { solana: { usd: number } };
      return Number(j.solana.usd);
    },
  ];

  for (const s of sources) {
    try {
      const usd = await s();
      if (Number.isFinite(usd) && usd > 0) {
        cached = { usd, at: Date.now() };
        return usd;
      }
    } catch {
      // try next source
    }
  }

  cached = { usd: FALLBACK_SOL_USD, at: Date.now() };
  return FALLBACK_SOL_USD;
}

/**
 * Jupiter aggregator client (server-side).
 *
 * Live fills route through Jupiter rather than calling the pump.fun program
 * directly. One integration covers both sides of a coin's life: the "Pump.fun"
 * bonding curve before graduation and the "Pump.fun Amm" pool after it. Doing
 * this by hand means tracking two program layouts, their PDAs and their account
 * orderings — all of which change.
 *
 * The server only ever builds an *unsigned* transaction and hands the bytes to
 * the browser. Signing happens inside Privy; no key material reaches this code.
 */

const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

/** Wrapped SOL — what we quote against for both buys and sells. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo?: { label?: string; ammKey?: string } }>;
};

export class JupiterError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export function routeLabels(quote: JupiterQuote): string[] {
  return (quote.routePlan ?? [])
    .map((r) => r.swapInfo?.label)
    .filter((l): l is string => Boolean(l));
}

/**
 * Fetch a route. Throws JupiterError("NO_ROUTE") when the aggregator can't find
 * a path — which is the signal a caller shows instead of pretending to fill.
 */
export async function jupiterQuote(opts: {
  inputMint: string;
  outputMint: string;
  /** raw base units */
  amount: string | bigint;
  slippageBps?: number;
  timeoutMs?: number;
}): Promise<JupiterQuote> {
  const { inputMint, outputMint, slippageBps = 500 } = opts;
  const amount = opts.amount.toString();

  const url =
    `${QUOTE_URL}?inputMint=${encodeURIComponent(inputMint)}` +
    `&outputMint=${encodeURIComponent(outputMint)}` +
    `&amount=${encodeURIComponent(amount)}` +
    `&slippageBps=${slippageBps}` +
    `&restrictIntermediateTokens=true`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      cache: "no-store",
    });
  } catch (e) {
    throw new JupiterError(`quote request failed: ${(e as Error).message}`, "QUOTE_UNAVAILABLE");
  }

  if (!res.ok) {
    // Jupiter answers 400 with {error, errorCode} when there's simply no path.
    const body = await res.text().catch(() => "");
    throw new JupiterError(
      body.slice(0, 200) || `quote failed with ${res.status}`,
      res.status === 400 ? "NO_ROUTE" : "QUOTE_UNAVAILABLE",
    );
  }

  const quote = (await res.json()) as JupiterQuote;
  if (!quote?.outAmount || quote.outAmount === "0") {
    throw new JupiterError("route returned zero output", "NO_ROUTE");
  }
  return quote;
}

/**
 * Turn a quote into a signable transaction. Returns base64 — Jupiter's payload
 * verbatim, so the browser signs exactly what the aggregator built.
 */
export async function jupiterSwapTransaction(opts: {
  quote: JupiterQuote;
  userPublicKey: string;
  /** lamports cap for the priority fee */
  maxPriorityFeeLamports?: number;
  timeoutMs?: number;
}): Promise<{ swapTransaction: string; lastValidBlockHeight?: number }> {
  const body = {
    quoteResponse: opts.quote,
    userPublicKey: opts.userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: opts.maxPriorityFeeLamports ?? 1_000_000,
        priorityLevel: "high",
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(SWAP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      cache: "no-store",
    });
  } catch (e) {
    throw new JupiterError(`swap request failed: ${(e as Error).message}`, "SWAP_UNAVAILABLE");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new JupiterError(text.slice(0, 200) || `swap failed with ${res.status}`, "SWAP_UNAVAILABLE");
  }

  const json = (await res.json()) as {
    swapTransaction?: string;
    lastValidBlockHeight?: number;
  };
  if (!json.swapTransaction) {
    throw new JupiterError("swap response carried no transaction", "SWAP_UNAVAILABLE");
  }
  return {
    swapTransaction: json.swapTransaction,
    lastValidBlockHeight: json.lastValidBlockHeight,
  };
}

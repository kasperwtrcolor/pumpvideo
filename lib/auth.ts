import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readTrader } from "./session";
import type { TraderRecord } from "./session";

/**
 * Gate for routes that require a *verified* identity, not just a cookie.
 *
 * A session cookie is only ever minted after a verified SIWS signature (see
 * app/api/auth/session), so the cookie itself is the proof of wallet ownership.
 * On top of that, when the client presents its wallet as a bearer marker we
 * require it to match the wallet the session was minted for — so a request
 * carrying a mismatched wallet is refused even if the cookie leaked.
 *
 * Returns the trader, or a ready-made error response. Callers use it as:
 *
 *   const auth = await requireTrader(req);
 *   if ("response" in auth) return auth.response;
 */
export async function requireTrader(
  req: NextRequest,
): Promise<{ trader: TraderRecord } | { response: NextResponse }> {
  const trader = await readTrader();

  if (!trader || !trader.walletAddress) {
    return {
      response: NextResponse.json(
        { error: "NOT_AUTHENTICATED", detail: "connect a wallet to do that" },
        { status: 401 },
      ),
    };
  }

  const header = req.headers.get("authorization") ?? "";
  const marker = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (marker && marker !== trader.walletAddress) {
    return {
      response: NextResponse.json({ error: "WALLET_MISMATCH" }, { status: 401 }),
    };
  }

  return { trader };
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { privyConfigured, traderFromAuthHeader } from "./privy";
import type { TraderRecord } from "./session";

/**
 * Gate for routes that require a *verified* identity, not just a cookie.
 *
 * Everything a viewer creates — a like, a comment, an upload — is attributed to
 * a Privy-verified trader. A cookie alone is not enough: it is unauthenticated
 * state that anyone could forge by guessing, and it would let a script farm
 * likes without ever logging in.
 *
 * Returns the trader, or a ready-made error response. Callers use it as:
 *
 *   const auth = await requireTrader(req);
 *   if ("response" in auth) return auth.response;
 */
export async function requireTrader(
  req: NextRequest,
): Promise<{ trader: TraderRecord } | { response: NextResponse }> {
  if (!privyConfigured()) {
    return {
      response: NextResponse.json(
        { error: "PRIVY_NOT_CONFIGURED", detail: "login is not configured on this deployment" },
        { status: 503 },
      ),
    };
  }

  let trader: TraderRecord | null = null;
  try {
    trader = await traderFromAuthHeader(req);
  } catch {
    return {
      response: NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 }),
    };
  }

  if (!trader) {
    return {
      response: NextResponse.json(
        { error: "NOT_AUTHENTICATED", detail: "log in to do that" },
        { status: 401 },
      ),
    };
  }

  return { trader };
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  bindPrivyTrader,
  fetchPrivyProfile,
  fetchPrivyProfileByDid,
  privyConfigured,
  verifyPrivyToken,
} from "@/lib/privy";
import { publicTrader } from "@/lib/api";
import { TRADER_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/session
 * body: { accessToken: string, identityToken?: string }
 *
 * Exchanges a Privy session for an app session.
 *
 * The token is verified server-side before anything is written — a client that
 * simply *claims* a user id gets nothing. On success the existing anonymous
 * trader (if any) is adopted rather than replaced, so practice balances and
 * positions survive logging in.
 */
export async function POST(req: NextRequest) {
  if (!privyConfigured()) {
    return NextResponse.json(
      { error: "PRIVY_NOT_CONFIGURED", detail: "login is not configured on this deployment" },
      { status: 503 },
    );
  }

  let body: { accessToken?: string; identityToken?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  const accessToken = body.accessToken?.trim();
  if (!accessToken) {
    return NextResponse.json({ error: "MISSING_TOKEN" }, { status: 401 });
  }

  // 1. Cryptographic verification — signature, issuer, app id, expiry.
  let userId: string;
  try {
    const claims = await verifyPrivyToken(accessToken);
    userId = claims.userId;
  } catch {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
  }

  // 2. Read the profile (id token first — the DID lookup is rate-limited).
  let profile;
  try {
    const identityToken = body.identityToken?.trim();
    profile = identityToken
      ? await fetchPrivyProfile(identityToken)
      : await fetchPrivyProfileByDid(userId);
  } catch {
    return NextResponse.json({ error: "PROFILE_FETCH_FAILED" }, { status: 502 });
  }

  // 3. Bind to a trader, adopting the caller's anonymous row when possible.
  const anonHandle = req.cookies.get(TRADER_COOKIE)?.value ?? null;
  const trader = await bindPrivyTrader(profile, anonHandle);

  const res = NextResponse.json({ ok: true, trader: publicTrader(trader) });
  res.cookies.set(TRADER_COOKIE, trader.handle, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

/**
 * DELETE /api/auth/session — sign out.
 *
 * Only the app session is cleared. The Privy session is ended client-side by
 * `logout()`; doing it here would require forwarding a token we don't need.
 * The next request transparently provisions a fresh anonymous practice trader.
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TRADER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
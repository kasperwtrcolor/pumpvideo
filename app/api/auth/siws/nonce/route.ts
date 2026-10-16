import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  buildSiwsMessage,
  isValidSolanaAddress,
  newNonce,
  signNonce,
  SIWS_NONCE_COOKIE,
} from "@/lib/siws";

export const dynamic = "force-dynamic";

/** The origin a browser is talking to, used as the SIWS domain. */
function domainOf(req: NextRequest): string {
  const host = req.headers.get("host");
  if (host) return host;
  return new URL(req.url).host;
}

/**
 * GET /api/auth/siws/nonce?wallet=<address>
 *
 * Issues a one-time challenge for a wallet to sign. The nonce is stored in a
 * short-lived, HMAC-signed httpOnly cookie rather than server-side state, so the
 * challenge survives across serverless instances without a store — and the HMAC
 * is what stops a forged cookie from passing off an attacker-chosen nonce.
 *
 * The message is returned to the client verbatim; the client signs exactly these
 * bytes and posts them back.
 */
export async function GET(req: NextRequest) {
  const wallet = (req.nextUrl.searchParams.get("wallet") ?? "").trim();

  if (!wallet || !isValidSolanaAddress(wallet)) {
    return NextResponse.json(
      { error: "BAD_WALLET", detail: "connect a valid Solana wallet first" },
      { status: 400 },
    );
  }

  const domain = domainOf(req);
  const nonce = newNonce();
  const issuedAtMs = Date.now();
  const issuedAt = new Date(issuedAtMs).toISOString();
  const purpose = req.nextUrl.searchParams.get("purpose") === "payout" ? "payout" : "login";

  const message = buildSiwsMessage({ domain, wallet, nonce, issuedAt, purpose });

  const res = NextResponse.json({ wallet, nonce, message, purpose });
  res.cookies.set(SIWS_NONCE_COOKIE, signNonce(nonce, issuedAtMs), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 5,
  });
  return res;
}

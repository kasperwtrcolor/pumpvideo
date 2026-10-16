import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { bindWalletTrader, TRADER_COOKIE } from "@/lib/session";
import { isValidSolanaAddress, SIWS_NONCE_COOKIE, verifyNonceCookie, verifySiws } from "@/lib/siws";
import { publicTrader } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/session
 * body: { wallet: string, message: string, signature: string }
 *
 * Exchanges a signed SIWS challenge for an app session.
 *
 * The signature is verified server-side before anything is written — a client
 * that merely *claims* a wallet gets nothing. The nonce must match the one we
 * issued (from the httpOnly cookie), so a captured signature cannot be replayed
 * into a fresh login. On success the caller's anonymous trader row is adopted
 * rather than replaced, so likes, comments, uploads and positions survive.
 */
export async function POST(req: NextRequest) {
  let body: { wallet?: string; message?: string; signature?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  const wallet = body.wallet?.trim() ?? "";
  const message = body.message ?? "";
  const signature = body.signature?.trim() ?? "";

  if (!wallet || !message || !signature) {
    return NextResponse.json(
      { error: "MISSING_FIELDS", detail: "wallet, message and signature are all required" },
      { status: 400 },
    );
  }
  if (!isValidSolanaAddress(wallet)) {
    return NextResponse.json({ error: "BAD_WALLET" }, { status: 400 });
  }

  // 1. The nonce we issued for this browser.
  const nonce = verifyNonceCookie(req.cookies.get(SIWS_NONCE_COOKIE)?.value);
  if (!nonce) {
    return NextResponse.json(
      { error: "NO_CHALLENGE", detail: "request a sign-in challenge again" },
      { status: 401 },
    );
  }

  // 2. Cryptographic verification — signature over OUR message, for THIS wallet.
  if (!verifySiws({ message, signatureB64: signature, wallet, nonce })) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  // 3. Bind to a trader, adopting the caller's anonymous row when possible.
  const anonHandle = req.cookies.get(TRADER_COOKIE)?.value ?? null;
  const trader = await bindWalletTrader(wallet, anonHandle);

  const res = NextResponse.json({ ok: true, trader: publicTrader(trader) });
  res.cookies.set(TRADER_COOKIE, trader.handle, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Spend the challenge — a nonce is single-use.
  res.cookies.set(SIWS_NONCE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

/**
 * DELETE /api/auth/session — sign out.
 *
 * Clears the app session cookie. The wallet stays connected in the extension;
 * the client disconnects it. The next request transparently provisions a fresh
 * anonymous trader.
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TRADER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireTrader } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { payoutAddress } from "@/lib/session";
import { isValidSolanaAddress, SIWS_NONCE_COOKIE, verifyNonceCookie, verifySiws } from "@/lib/siws";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/payout
 * body: { wallet: string, message: string, signature: string }
 *
 * Change where this trader's creator fees are paid.
 *
 * Why this endpoint exists at all: a clip freezes `creatorWallet` at upload, and
 * under connect-wallet a trader can swap wallets at any time. Without a way to
 * re-point, a creator who moves to a new wallet keeps earning into the old one —
 * which they may no longer control. So this takes a *proven* new address (a SIWS
 * signature from it, not just a claimed string) and re-points the trader AND
 * every clip they uploaded.
 *
 * Setting the new wallet equal to the connected wallet clears `payoutWallet`
 * back to null ("just use my wallet").
 */
export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

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
    return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
  }
  if (!isValidSolanaAddress(wallet)) {
    return NextResponse.json({ error: "BAD_WALLET" }, { status: 400 });
  }

  const nonce = verifyNonceCookie(req.cookies.get(SIWS_NONCE_COOKIE)?.value);
  if (!nonce) {
    return NextResponse.json({ error: "NO_CHALLENGE" }, { status: 401 });
  }
  if (!verifySiws({ message, signatureB64: signature, wallet, nonce })) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const previous = payoutAddress(trader);
  // A wallet equal to the connected one is the default — store null, not a copy,
  // so it keeps tracking the connected wallet instead of pinning a snapshot.
  const next = wallet === trader.walletAddress ? null : wallet;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.trader.update({
      where: { id: trader.id },
      data: { payoutWallet: next },
    });
    // Re-point this creator's existing clips, but only ones that pointed at the
    // old payout address — never touch a clip with a different destination.
    if (previous && previous !== wallet) {
      await tx.clip.updateMany({
        where: { uploadedById: trader.id, creatorWallet: previous },
        data: { creatorWallet: wallet },
      });
    } else {
      await tx.clip.updateMany({
        where: { uploadedById: trader.id },
        data: { creatorWallet: wallet },
      });
    }
    return t;
  });

  const res = NextResponse.json({
    ok: true,
    payoutWallet: payoutAddress(updated),
    rePoints: previous !== wallet,
  });
  res.cookies.set(SIWS_NONCE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

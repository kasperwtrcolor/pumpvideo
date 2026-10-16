import type { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";
import { requireTrader } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet  { address: "<base58 pubkey>" | null }
 *
 * Attaches an existing external Solana wallet to the signed-in account.
 *
 * Requires a verified wallet session (SIWS). Without that check any anonymous
 * visitor could claim an arbitrary public key and squat it against the unique
 * index — and because funded wallets can't be moved by anyone but their owner,
 * the only sane rule is "prove you control a wallet before you can name one".
 *
 * This is only for people who want a *different* wallet recognised on the
 * account; the wallet they signed in with is already the account's wallet.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTrader(req);
  if ("response" in auth) return auth.response;
  const { trader } = auth;

  let address: string | null = null;
  try {
    const body = (await req.json()) as { address?: string | null };
    address = body.address ?? null;
  } catch {
    return withTrader({ error: "BAD_JSON" }, { status: 400, trader });
  }

  if (address !== null) {
    try {
      // Validate it's a real ed25519 Solana address.
      const pk = new PublicKey(address);
      if (!PublicKey.isOnCurve(pk.toBytes())) {
        return withTrader(
          { error: "OFF_CURVE", detail: "that is not a wallet address" },
          { status: 400, trader },
        );
      }
    } catch {
      return withTrader(
        { error: "BAD_PUBKEY", detail: "not a valid base58 Solana address" },
        { status: 400, trader },
      );
    }
  }

  const taken = address
    ? await prisma.trader.findUnique({ where: { walletAddress: address } })
    : null;
  if (taken && taken.id !== trader.id) {
    return withTrader(
      { error: "WALLET_IN_USE", detail: "that wallet is linked to another account" },
      { status: 409, trader },
    );
  }

  const updated = await prisma.trader.update({
    where: { id: trader.id },
    data: { walletAddress: address },
  });

  return withTrader(
    { ok: true, walletAddress: address, liveReady: false },
    { trader: updated },
  );
}
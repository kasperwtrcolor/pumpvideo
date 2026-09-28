import type { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { withTrader } from "@/lib/api";
import { resolveTrader } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet  { address: "<base58 pubkey>" | null }
 *
 * Links a Solana wallet to the anonymous trader row. Linking does NOT switch the
 * app into live trading — that requires executeLiveFill() to be implemented.
 * It exists so the identity/custody seam is real from day one.
 */
export async function POST(req: NextRequest) {
  const { trader, created } = await resolveTrader();

  let address: string | null = null;
  try {
    const body = (await req.json()) as { address?: string | null };
    address = body.address ?? null;
  } catch {
    return withTrader({ error: "BAD_JSON" }, { status: 400, trader, created });
  }

  if (address !== null) {
    try {
      // Validate it's a real ed25519 Solana address.
      const pk = new PublicKey(address);
      if (!PublicKey.isOnCurve(pk.toBytes())) {
        return withTrader(
          { error: "OFF_CURVE", detail: "that is not a wallet address" },
          { status: 400, trader, created },
        );
      }
    } catch {
      return withTrader(
        { error: "BAD_PUBKEY", detail: "not a valid base58 Solana address" },
        { status: 400, trader, created },
      );
    }
  }

  const taken = address
    ? await prisma.trader.findUnique({ where: { walletAddress: address } })
    : null;
  if (taken && taken.id !== trader.id) {
    return withTrader(
      { error: "WALLET_IN_USE", detail: "that wallet is linked to another session" },
      { status: 409, trader, created },
    );
  }

  const updated = await prisma.trader.update({
    where: { id: trader.id },
    data: { walletAddress: address },
  });

  return withTrader(
    { ok: true, walletAddress: address, liveReady: false },
    { trader: updated, created },
  );
}

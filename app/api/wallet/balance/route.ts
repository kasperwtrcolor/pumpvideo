import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SOLANA_RPC } from "@/lib/pumpfun";
import { clientKey, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/balance?address=<base58>
 *
 * Live SOL balance for a public address. Proxied through the server so the RPC
 * endpoint (and any key on it) never has to be handed to the browser.
 *
 * Addresses are public data, so this needs no auth — but it is rate limited so
 * it can't be used as a free RPC proxy.
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(`bal:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address) return NextResponse.json({ error: "MISSING_ADDRESS" }, { status: 400 });

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
    if (!PublicKey.isOnCurve(pubkey.toBytes())) throw new Error("off curve");
  } catch {
    return NextResponse.json({ error: "BAD_PUBKEY" }, { status: 400 });
  }

  try {
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const lamports = await conn.getBalance(pubkey);
    return NextResponse.json(
      { address, lamports, sol: lamports / LAMPORTS_PER_SOL },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "RPC_UNAVAILABLE" }, { status: 502 });
  }
}
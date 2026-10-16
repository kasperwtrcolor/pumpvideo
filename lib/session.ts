import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "./db";

export const TRADER_COOKIE = "pumpclip_trader";

/** A trader row as stored. */
export type TraderRecord = {
  id: string;
  handle: string;
  walletAddress: string | null;
  /** Stated payout address for creator fees; falls back to walletAddress. */
  payoutWallet: string | null;
  displayName: string | null;
  username: string | null;
  bio: string | null;
  avatarUrl: string | null;
  privyDid: string | null;
  email: string | null;
  loginMethod: string | null;
  createdAt: Date;
};

/**
 * The address a trader's creator fees should be paid to. One definition, used by
 * every path that has to write or read a payout destination, so the fallback
 * rule can never drift between them.
 */
export function payoutAddress(t: {
  payoutWallet: string | null;
  walletAddress: string | null;
}): string | null {
  return t.payoutWallet ?? t.walletAddress ?? null;
}

/**
 * 128 bits of randomness. The old 32-bit handle was fine when the cookie only
 * held play money, but a session now unlocks a real wallet address and the
 * account's activity — that needs to be unguessable, not merely unique.
 */
function newHandle() {
  return `anon-${randomBytes(16).toString("hex")}`;
}

/**
 * Resolve the current trader from the session cookie.
 * A viewer still gets a real row on first request — that's what lets an
 * anonymous visit view clips, and what a login is later adopted into.
 * `created` tells the caller to send a Set-Cookie.
 */
export async function resolveTrader(): Promise<{
  trader: TraderRecord;
  created: boolean;
  handle: string;
}> {
  const jar = await cookies();
  const existing = jar.get(TRADER_COOKIE)?.value;

  if (existing) {
    const trader = await prisma.trader.findUnique({ where: { handle: existing } });
    if (trader) return { trader, created: false, handle: existing };
  }

  const handle = newHandle();
  const trader = await prisma.trader.create({ data: { handle } });
  return { trader, created: true, handle };
}

/** Same as resolveTrader but safe to call from a Server Component (cannot set cookies). */
export async function readTrader() {
  const jar = await cookies();
  const handle = jar.get(TRADER_COOKIE)?.value;
  if (!handle) return null;
  return prisma.trader.findUnique({ where: { handle } });
}

/**
 * Bind a wallet that has just been PROVEN (a verified SIWS signature) to a
 * trader row.
 *
 * Identical adoption rule to the old Privy binding: a wallet already bound to a
 * trader is returned as-is; otherwise the caller's anonymous row is adopted so
 * the likes, comments, uploads and positions they built up while signed-out
 * survive the login instead of being orphaned behind a second row.
 */
export async function bindWalletTrader(
  wallet: string,
  anonHandle: string | null,
): Promise<TraderRecord> {
  const existing = await prisma.trader.findUnique({ where: { walletAddress: wallet } });
  if (existing) return existing;

  if (anonHandle) {
    const anon = await prisma.trader.findUnique({ where: { handle: anonHandle } });
    // Only adopt a row that is genuinely anonymous — never steal one that
    // already belongs to another wallet.
    if (anon && !anon.walletAddress) {
      return prisma.trader.update({
        where: { id: anon.id },
        data: { walletAddress: wallet, loginMethod: "WALLET" },
      });
    }
  }

  return prisma.trader.create({
    data: { handle: newHandle(), walletAddress: wallet, loginMethod: "WALLET" },
  });
}

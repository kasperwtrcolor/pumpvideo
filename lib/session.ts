import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { prisma } from "./db";

export const TRADER_COOKIE = "pumpclip_trader";

/** A trader row as stored. */
export type TraderRecord = {
  id: string;
  handle: string;
  walletAddress: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  privyDid: string | null;
  email: string | null;
  loginMethod: string | null;
  practiceBalance: number;
  practiceStartBal: number;
  createdAt: Date;
};

/**
 * 128 bits of randomness. The old 32-bit handle was fine when the cookie only
 * held play money, but a session now unlocks a real wallet address and the
 * account's practice history — that needs to be unguessable, not merely unique.
 */
function newHandle() {
  return `anon-${randomBytes(16).toString("hex")}`;
}

/**
 * Resolve the current trader from the session cookie.
 * Anonymous viewers still get a real row — that's what makes practice mode
 * work without a wallet. `created` tells the caller to send a Set-Cookie.
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

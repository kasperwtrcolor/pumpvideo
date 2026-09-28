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
  practiceBalance: number;
  practiceStartBal: number;
  createdAt: Date;
};

function newHandle() {
  return `anon-${randomBytes(4).toString("hex")}`;
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

import { NextResponse } from "next/server";
import { resolveTrader, TRADER_COOKIE } from "./session";
import type { TraderRecord } from "./session";
import { liveTradingEnabled } from "./capabilities";

export type { TraderRecord };

/**
 * JSON response that also establishes the anonymous trader cookie when needed.
 *
 * IMPORTANT: pass the trader you already resolved. Calling resolveTrader() twice
 * inside one request creates two rows when the caller has no cookie yet — the
 * write lands on one trader and the cookie points at another. That bug silently
 * drops every first trade.
 */
export async function withTrader<T>(
  body: T,
  init?: { status?: number; trader?: TraderRecord; created?: boolean },
): Promise<NextResponse> {
  const resolved =
    init?.trader !== undefined
      ? { trader: init.trader, created: init.created ?? false }
      : await resolveTrader();

  const res = NextResponse.json(
    { ...body, trader: publicTrader(resolved.trader) },
    { status: init?.status ?? 200 },
  );
  if (resolved.created) {
    res.cookies.set(TRADER_COOKIE, resolved.trader.handle, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export function publicTrader(t: {
  id: string;
  handle: string;
  walletAddress: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  privyDid: string | null;
  email: string | null;
  loginMethod: string | null;
}) {
  return {
    id: t.id,
    handle: t.handle,
    walletAddress: t.walletAddress,
    displayName: t.displayName,
    avatarUrl: t.avatarUrl,
    email: t.email,
    loginMethod: t.loginMethod,
    loggedIn: Boolean(t.privyDid),
    // Whether this *app* can place real on-chain trades at all. Not a statement
    // about the viewer's wallet — the trade sheet checks that separately. It is
    // what lets an operator pin the app to read-only with LIVE_TRADING_ENABLED=false.
    canTrade: liveTradingEnabled(),
  };
}

export function serializeCoin(c: {
  mint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  priceSol: number;
  marketCapSol: number;
  change24hPct: number;
  holders: number;
  volume24hSol: number;
  complete: boolean;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  launchedAt: Date | null;
  virtualSol: string;
  virtualToken: string;
  totalSupply: string;
}) {
  return {
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    imageUrl: c.imageUrl,
    priceSol: c.priceSol,
    marketCapSol: c.marketCapSol,
    change24hPct: c.change24hPct,
    holders: c.holders,
    volume24hSol: c.volume24hSol,
    complete: c.complete,
    twitter: c.twitter,
    telegram: c.telegram,
    website: c.website,
    launchedAt: c.launchedAt,
    virtualSol: c.virtualSol,
    virtualToken: c.virtualToken,
    totalSupply: c.totalSupply,
    buyPresetsSol: [0.1, 0.25, 0.5, 1],
    sellPresetsPct: [0.25, 0.5, 1],
  };
}

export function serializeClip(c: {
  id: string;
  source: string;
  videoUrl: string;
  thumbUrl: string | null;
  caption: string | null;
  author: string | null;
  creatorWallet?: string | null;
  likes: number;
  shares: number;
  comments: number;
  views: number;
}) {
  return {
    id: c.id,
    source: c.source,
    videoUrl: c.videoUrl,
    thumbUrl: c.thumbUrl,
    caption: c.caption,
    author: c.author,
    creatorWallet: c.creatorWallet ?? null,
    likes: c.likes,
    shares: c.shares,
    comments: c.comments,
    views: c.views,
  };
}

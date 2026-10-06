import { NextResponse } from "next/server";
import { resolveTrader, TRADER_COOKIE } from "./session";
import type { TraderRecord } from "./session";
import { liveTradingEnabled } from "./capabilities";
import { rawTokensToUi } from "./bonding-curve";

export type { TraderRecord };

/**
 * The caller's holding in one coin, sized against a given price.
 *
 * `entrySol` is the number the feed colours against: everything above it is
 * green, everything below is red. It is derived (cost / tokens) rather than
 * stored, so it stays correct after a partial sell has trimmed the cost basis.
 */
export function positionLite(
  p: { tokenAmount: string; costSol: number },
  priceSol: number,
) {
  const tokens = rawTokensToUi(p.tokenAmount);
  const valueSol = tokens * priceSol;
  return {
    tokens,
    costSol: p.costSol,
    entrySol: tokens > 0 ? p.costSol / tokens : 0,
    valueSol,
    pnlSol: valueSol - p.costSol,
    pnlPct: p.costSol > 0 ? ((valueSol - p.costSol) / p.costSol) * 100 : 0,
  };
}

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

/**
 * The trader shape handed to the browser.
 *
 * Deliberately omits `handle`. The handle *is* the session cookie value, and
 * the cookie is httpOnly precisely so script cannot read it — echoing it in a
 * JSON payload handed that guarantee straight back. Nothing in the client ever
 * needed it; identity for display comes from `username`/`displayName`, and the
 * server resolves the session from the cookie on every request.
 */
export function publicTrader(t: {
  id: string;
  handle: string;
  walletAddress: string | null;
  displayName: string | null;
  username?: string | null;
  bio?: string | null;
  avatarUrl: string | null;
  privyDid: string | null;
  email: string | null;
  loginMethod: string | null;
}) {
  return {
    id: t.id,
    walletAddress: t.walletAddress,
    displayName: t.displayName,
    username: t.username ?? null,
    bio: t.bio ?? null,
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
  change5mPct: number;
  volatility5m: number;
  holders: number;
  volume24hSol: number;
  complete: boolean;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  quoteSymbol: string | null;
  quoteName: string | null;
  quoteIconUrl: string | null;
  launchedAt: Date | null;
  createdAt: Date;
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
    change5mPct: c.change5mPct,
    volatility5m: c.volatility5m,
    holders: c.holders,
    volume24hSol: c.volume24hSol,
    complete: c.complete,
    twitter: c.twitter,
    telegram: c.telegram,
    website: c.website,
    /// The counterparty this coin is quoted against, or null for a SOL pair
    /// (every pump.fun and Dexscreener coin). The badge renders the mark, so the
    /// icon rides along with the name rather than being fetched client-side.
    quoteSymbol: c.quoteSymbol,
    quoteName: c.quoteName,
    quoteIconUrl: c.quoteIconUrl,
    launchedAt: c.launchedAt,
    /// When this row entered our catalogue. The age shown in the UI falls back
    /// to this when pump.fun gave us no `launchedAt`, so every coin can display
    /// an age rather than a dash.
    createdAt: c.createdAt,
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
  videoUrl: string | null;
  thumbUrl: string | null;
  caption: string | null;
  author: string | null;
  creatorWallet?: string | null;
  /// The uploading trader, so a viewer can tap through to their profile and
  /// follow them. Null for seeded clips, which have no creator account.
  uploadedById?: string | null;
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
    creatorId: c.uploadedById ?? null,
    creatorWallet: c.creatorWallet ?? null,
    likes: c.likes,
    shares: c.shares,
    comments: c.comments,
    views: c.views,
  };
}

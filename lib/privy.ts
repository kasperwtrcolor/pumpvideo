/**
 * Server-side Privy identity.
 *
 * The app secret lives here and never crosses to the browser. Two rules this
 * module exists to enforce:
 *
 *   1. A Privy token is only trusted after `verifyAuthToken` checks its ES256
 *      signature against the app's verification key. Decoding a JWT without
 *      verifying it is the classic way to let anyone impersonate anyone.
 *
 *   2. The user profile is fetched with `getUser({ idToken })`, not
 *      `getUser(userId)`. The DID lookup is explicitly deprecated by Privy
 *      because it carries strict rate limits that break as traffic grows.
 */
import { PrivyClient } from "@privy-io/server-auth";
import type { AuthTokenClaims, User } from "@privy-io/server-auth";
import { prisma } from "./db";
import type { TraderRecord } from "./session";

let cached: PrivyClient | null = null;

export function privyAppId(): string | null {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;
}

/** Whether login is available at all. Everything Privy-related degrades to
 *  practice-mode when this is false, so a missing env var can't brick the app. */
export function privyConfigured(): boolean {
  return Boolean(privyAppId() && process.env.PRIVY_APP_SECRET?.trim());
}

function client(): PrivyClient {
  if (!privyConfigured()) throw new Error("PRIVY_NOT_CONFIGURED");
  if (!cached) {
    cached = new PrivyClient(privyAppId()!, process.env.PRIVY_APP_SECRET!.trim());
  }
  return cached;
}

export type PrivyProfile = {
  privyDid: string;
  email: string | null;
  loginMethod: "EMAIL" | "GOOGLE" | "TWITTER" | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** The user's Solana embedded wallet, if one has been created yet. */
  walletAddress: string | null;
  walletId: string | null;
};

/** Verify an access token. Throws on tampering, expiry, or wrong app id. */
export async function verifyPrivyToken(token: string): Promise<AuthTokenClaims> {
  return client().verifyAuthToken(token);
}

function pickSolanaWallet(user: User): { address: string; id: string | null } | null {
  const wallets = (user.linkedAccounts ?? []).filter(
    (a): a is Extract<typeof a, { type: "wallet" }> =>
      a.type === "wallet" && (a as { chainType?: string }).chainType === "solana",
  );
  if (wallets.length === 0) return null;
  // Prefer the embedded (Privy-managed) wallet over any imported/external one.
  const embedded = wallets.find((w) => (w as { walletClientType?: string }).walletClientType === "privy");
  const chosen = embedded ?? wallets[0];
  return { address: chosen.address, id: chosen.id ?? null };
}

/**
 * Resolve the caller's profile from an *identity* token.
 * Preferred: Privy applies no strict rate limit to id-token lookups.
 */
export async function fetchPrivyProfile(idToken: string): Promise<PrivyProfile> {
  return profileFromUser(await client().getUser({ idToken }));
}

/**
 * Fallback when no identity token is available yet.
 * `getUser(userId)` is deprecated upstream precisely because it is strictly
 * rate-limited, so this is only a safety net — the id-token path is the one
 * that scales.
 */
export async function fetchPrivyProfileByDid(userId: string): Promise<PrivyProfile> {
  return profileFromUser(await client().getUser(userId));
}

function profileFromUser(user: User): PrivyProfile {
  const google = user.google;
  const twitter = user.twitter;
  const email = user.email?.address ?? google?.email ?? null;

  const loginMethod: PrivyProfile["loginMethod"] = google
    ? "GOOGLE"
    : twitter
      ? "TWITTER"
      : email
        ? "EMAIL"
        : null;

  const solana = pickSolanaWallet(user);

  const first = google?.name?.split(" ")[0] ?? twitter?.name ?? twitter?.username ?? null;
  const displayName = first ?? (email ? email.split("@")[0] : null) ?? null;

  return {
    privyDid: user.id,
    email,
    loginMethod,
    displayName,
    // Only Twitter exposes an avatar server-side; `Google` carries just
    // subject/email/name, so Google users fall back to the initials dot.
    avatarUrl: twitter?.profilePictureUrl ?? null,
    walletAddress: solana?.address ?? null,
    walletId: solana?.id ?? null,
  };
}

/**
 * Bind a verified Privy identity to a trader row.
 *
 * If the caller arrived anonymously (practice mode) we ADOPT that row rather
 * than creating a second one — otherwise logging in silently wipes the practice
 * balance and positions the visitor had been building up.
 *
 * `anonHandle` is the cookie's current value; pass null if there is none.
 */
export async function bindPrivyTrader(
  profile: PrivyProfile,
  anonHandle: string | null,
): Promise<TraderRecord> {
  const data = {
    privyDid: profile.privyDid,
    email: profile.email,
    loginMethod: profile.loginMethod,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    walletId: profile.walletId,
    ...(profile.walletAddress ? { walletAddress: profile.walletAddress } : {}),
  };

  const existing = await prisma.trader.findUnique({ where: { privyDid: profile.privyDid } });
  if (existing) {
    return prisma.trader.update({ where: { id: existing.id }, data });
  }

  // Adopt the anonymous row this browser has been using, if it isn't already
  // claimed by a different Privy user.
  if (anonHandle) {
    const anon = await prisma.trader.findUnique({ where: { handle: anonHandle } });
    if (anon && !anon.privyDid) {
      return prisma.trader.update({ where: { id: anon.id }, data });
    }
  }

  return prisma.trader.create({ data: { handle: `user-${profile.privyDid.replace(/[^a-zA-Z0-9]/g, "").slice(-24)}`, ...data } });
}

/**
 * Resolve a trader from an `Authorization: Bearer <access token>` header.
 * Used by endpoints that touch real funds, where a cookie alone is not enough.
 * Throws PrivyNotConfiguredError / verification errors up to the caller.
 */
export async function traderFromAuthHeader(req: Request): Promise<TraderRecord | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const claims = await verifyPrivyToken(token);
  const trader = await prisma.trader.findUnique({ where: { privyDid: claims.userId } });
  return trader;
}
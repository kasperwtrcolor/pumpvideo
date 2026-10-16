/**
 * Sign-In With Solana (SIWS) — the whole authentication primitive.
 *
 * Replaces Privy. There is no vendor in the loop: the user proves they control a
 * wallet by signing a short message, we verify the ed25519 signature against the
 * public key named in that message, and that is the login. No token exchange, no
 * per-user cost, no cap.
 *
 * Two rules this module exists to enforce:
 *
 *   1. A claimed wallet is only trusted after the signature verifies. Reading the
 *      address out of the request body and believing it is how you let anyone
 *      log in as anyone.
 *
 *   2. The signed message must carry OUR nonce, and the wallet it names must be
 *      the wallet that signed. Otherwise a signature captured for one purpose
 *      (or one address) could be replayed at our login.
 *
 * Kept free of Prisma and of any request/response types so it can be exercised
 * directly in a test with a locally generated keypair.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

export const SIWS_NONCE_COOKIE = "pemp_siws_nonce";

/** How long a challenge stays valid. Short — a login should be one tap away. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

export const SIWS_STATEMENT =
  "Sign in to Pemp. This proves you own this wallet — it costs nothing and sends no transaction.";

/** Statement shown when signing to change where creator fees are paid. */
export const PAYOUT_STATEMENT =
  "Set this wallet as my Pemp creator-fee payout address. This costs nothing and sends no transaction.";

export type SiwsPurpose = "login" | "payout";

/**
 * Key for the HMAC that protects the nonce cookie.
 *
 * Falls back to the old Privy secret so an existing deployment keeps working
 * without a new env var; set SIWS_SECRET to move off it. The dev fallback is
 * deliberately obvious — a deployment that silently signed with a known key in
 * production would be worse than an ugly one.
 */
function cookieSecret(): string {
  return (
    process.env.SIWS_SECRET?.trim() ||
    process.env.PRIVY_APP_SECRET?.trim() ||
    "pemp-dev-siws-secret"
  );
}

export function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * The exact text a wallet is asked to sign. Human-readable on purpose: a wallet
 * shows this to the user before they approve, so it has to say what it is.
 */
export function buildSiwsMessage(opts: {
  domain: string;
  wallet: string;
  nonce: string;
  issuedAt: string;
  purpose?: SiwsPurpose;
}): string {
  const statement = opts.purpose === "payout" ? PAYOUT_STATEMENT : SIWS_STATEMENT;
  return [
    `${opts.domain} wants you to sign in with your Solana account:`,
    opts.wallet,
    "",
    statement,
    "",
    `URI: https://${opts.domain}`,
    "Version: 1",
    "Chain ID: solana:mainnet",
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt}`,
  ].join("\n");
}

/** Nonce cookie value: `nonce.issuedAtMs.hmac` — integrity-protected by HMAC. */
export function signNonce(nonce: string, issuedAtMs: number): string {
  const payload = `${nonce}.${issuedAtMs}`;
  const sig = createHmac("sha256", cookieSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify the nonce cookie's HMAC and freshness. Returns the nonce or null. */
export function verifyNonceCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [nonce, issuedAtMs, sig] = parts;
  const expected = createHmac("sha256", cookieSecret())
    .update(`${nonce}.${issuedAtMs}`)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const age = Date.now() - Number(issuedAtMs);
  if (!Number.isFinite(age) || age < 0 || age > NONCE_TTL_MS) return null;
  return nonce;
}

/**
 * Verify a signed SIWS message. True only when the signature is valid AND the
 * message is the one we issued for this nonce and this wallet.
 */
export function verifySiws(opts: {
  message: string;
  signatureB64: string;
  wallet: string;
  nonce: string;
}): boolean {
  try {
    const pubkey = new PublicKey(opts.wallet);
    const sig = Buffer.from(opts.signatureB64, "base64");
    if (sig.length !== nacl.sign.signatureLength) return false;

    const message = new TextEncoder().encode(opts.message);
    const ok = nacl.sign.detached.verify(message, sig, pubkey.toBytes());
    if (!ok) return false;

    // The message must be bound to our challenge and to this wallet. The
    // signature already covers the bytes, so these are cheap belt-and-braces
    // against a message that is validly signed but not ours.
    if (!opts.message.includes(`Nonce: ${opts.nonce}`)) return false;
    if (!opts.message.includes(opts.wallet)) return false;
    return true;
  } catch {
    return false;
  }
}

/** A Solana address we are willing to bind. Guards against junk wallets. */
export function isValidSolanaAddress(address: string): boolean {
  try {
    // On-curve: a wallet that can actually sign and receive. Rejects PDAs and
    // malformed strings, which would otherwise silently break fee payouts.
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

/**
 * Coin art URL normalisation — pure, dependency-free, safe to import from the
 * browser bundle. The server-side fetch helpers live in lib/art.ts.
 *
 * pump.fun mints point their art at a grab-bag of hosts — ipfs.io, pumppinata,
 * twitter CDNs, random marketing domains. ipfs.io in particular 403s datacenter
 * IPs, which left every clip rendered as a black card. Rewriting IPFS URLs onto
 * gateways that actually answer is what fixes both the feed and the avatars.
 */

const CID_RE = /(bafy[a-z0-9]{40,}|bafk[a-z0-9]{40,}|Qm[1-9A-HJ-NP-Za-km-z]{44})/;

/** Public IPFS gateways, best-answering first (probed Sep 2026). */
export const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.filebase.io/ipfs/",
  "https://4everland.io/ipfs/",
  "https://ipfs.io/ipfs/",
];

export function extractCid(url: string): string | null {
  const m = url.match(CID_RE);
  return m ? m[1] : null;
}

/**
 * Ordered list of URLs to try for one coin's art. Non-IPFS hosts are passed
 * through untouched; IPFS URLs expand to every gateway.
 */
export function artCandidates(url: string | null | undefined): string[] {
  if (!url) return [];
  const raw = url.trim();
  if (!raw) return [];

  // ipfs://<cid>/path
  if (raw.startsWith("ipfs://")) {
    const rest = raw.slice("ipfs://".length);
    return GATEWAYS.map((g) => g + rest);
  }

  const cid = extractCid(raw);

  // A bare CID (or <cid>.ipfs.dweb.link style) — rebuild from the CID.
  if (cid) {
    const pathMatch = raw.match(new RegExp(`${cid}(/.*)?$`));
    const suffix = pathMatch?.[1] ?? "";
    return GATEWAYS.map((g) => g + cid + suffix);
  }

  return [raw];
}

/** Single best-guess URL, for rendering directly in <img src>. */
export function artUrl(url: string | null | undefined): string | null {
  return artCandidates(url)[0] ?? null;
}

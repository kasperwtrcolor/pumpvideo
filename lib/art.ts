/**
 * Server-side coin art fetching.
 *
 * URL normalisation lives in lib/art-url.ts so the browser bundle can use it
 * without pulling in Node's Buffer. This module adds the downloading half.
 */
import { artCandidates, extractCid } from "./art-url";

export { artCandidates, artUrl, extractCid, GATEWAYS } from "./art-url";

export const ART_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
};

/** Download art, trying each candidate in order. Returns bytes + content type. */
export async function fetchArt(
  url: string | null | undefined,
  timeoutMs = 20000,
): Promise<{ buf: Buffer; contentType: string; source: string } | null> {
  for (const candidate of artCandidates(url)) {
    try {
      const res = await fetch(candidate, {
        headers: ART_FETCH_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      // Some hosts answer 200 with an HTML error page — reject those.
      if (ct.includes("text/html")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) continue;
      return { buf, contentType: ct, source: candidate };
    } catch {
      continue;
    }
  }
  return null;
}

/** Extension for a downloaded art blob, inferred from content type. */
export function artExt(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("svg")) return "svg";
  return "jpg";
}

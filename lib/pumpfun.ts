/**
 * Live market data client for pump.fun.
 *
 * Uses the public frontend API that the pump.fun UI itself calls. No key required.
 * We only ever read — all writes go through the live swap route.
 */

import type { CalloutDTO } from "./types";

const FEED_API = "https://frontend-api-v3.pump.fun";
const UA = "Mozilla/5.0 (compatible; pemp/0.1)";

export type PumpCoin = {
  mint: string;
  name: string;
  symbol: string;
  description: string | null;
  image_uri: string | null;
  metadata_uri: string | null;
  creator: string | null;
  created_timestamp: number;
  complete: boolean;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_sol_reserves: number;
  total_supply: number;
  market_cap: number;
  pool_address: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  is_banned?: boolean;
  nsfw?: boolean;
};

type Sort =
  | "market_cap"
  | "created_timestamp"
  | "last_trade_timestamp"
  | "ath_market_cap"
  | "reply_count";

/**
 * GET the ranked coin list, with retry.
 *
 * pump.fun rate-limits this endpoint aggressively and intermittently — in
 * testing roughly half of all pages came back 429 even with 300ms between
 * requests. Callers that treat a 429 as "no more data" end up silently
 * returning nothing, which is exactly how the market keeper reported
 * `updated: 0` while looking perfectly healthy.
 *
 * Retries on 429/5xx with exponential backoff + jitter, and throws only when it
 * has genuinely given up, so the failure is visible to the caller.
 */
export async function fetchCoins(opts: {
  limit?: number;
  offset?: number;
  sort?: Sort;
  order?: "ASC" | "DESC";
  attempts?: number;
} = {}): Promise<PumpCoin[]> {
  const { limit = 48, offset = 0, sort = "market_cap", order = "DESC", attempts = 4 } = opts;
  const url = `${FEED_API}/coins?offset=${offset}&limit=${limit}&sort=${sort}&order=${order}&includeNsfw=false`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      // 600ms, 1.2s, 2.4s ... plus up to 400ms jitter so parallel sweeps don't
      // re-collide on the same retry boundary.
      await sleep(600 * 2 ** (attempt - 1) + Math.random() * 400);
    }
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
    } catch (e) {
      lastErr = e;
      continue; // network blip — worth another go
    }

    if (res.ok) return (await res.json()) as PumpCoin[];

    const body = await res.text().catch(() => "");
    lastErr = new Error(`pump.fun ${res.status}: ${body.slice(0, 120)}`);

    // Cloudflare fronts pump.fun's API and now challenges datacenter IPs — both
    // this VPS and the Vercel deployment get a 403 "Just a moment..." on every
    // request, which is what froze new-token ingestion outright. Before treating
    // the 403 as final, re-ask the reader-relay for the same URL: it fetches from
    // a network Cloudflare does not challenge and hands back pump.fun's *own*
    // JSON, so everything downstream (the gates, the mapping, the keeper) is
    // unchanged. Only 403 is relayed — a 404 or a malformed body must surface as
    // itself, not be laundered through a proxy.
    if (res.status === 403) {
      const relayed = await fetchViaRelay(url);
      if (relayed) return relayed;
    }

    // 429 and 5xx are transient. Anything else (403, 404) is permanent — don't
    // burn attempts on it.
    if (res.status !== 429 && res.status < 500) throw lastErr;
  }
  throw lastErr;
}

/**
 * Fetch one coin by mint, or null when we can't find it.
 *
 * NOTE: pump.fun's v3 API has **no by-mint endpoint** — `GET /coins/{mint}`
 * 404s even for a mint that is demonstrably in the live list. So a single lookup
 * is a sweep of the ranked list. For more than one mint use
 * `fetchCoinsByMints()`, which sweeps once for the whole set.
 */
export async function fetchCoin(mint: string): Promise<PumpCoin | null> {
  const map = await fetchCoinsByMints([mint], { pages: 4 });
  return map.get(mint) ?? null;
}

/**
 * Resolve many mints in one sweep. Two passes:
 *   1. by market cap   — catches established coins
 *   2. by created time — catches brand-new coins that aren't ranked yet
 * Each pass pages until it runs out or has found everything it wants.
 *
 * Returns a Map of the mints it found. Mints absent from the result are not
 * refreshable through this API (they've fallen out of both rankings), and callers
 * should report that rather than pretend the sync succeeded.
 */
export async function fetchCoinsByMints(
  mints: string[],
  // `errors` is an out-param: pass an array and it collects per-page failures,
  // so callers can distinguish "coin isn't ranked" from "we were rate-limited".
  opts: { pages?: number; pageSize?: number; errors?: string[] } = {},
): Promise<Map<string, PumpCoin>> {
  // 10 pages x 50 x 2 sorts = up to 1000 coins swept. pump.fun launches
  // thousands of coins a day, so anything shallower loses low-cap coins within
  // hours and the keeper silently reports `updated: 0`.
  const { pages = 10, pageSize = 50, errors = [] } = opts;
  const want = new Set(mints);
  const found = new Map<string, PumpCoin>();
  if (want.size === 0) return found;

  const sweeps: Sort[] = ["market_cap", "created_timestamp"];

  for (const sort of sweeps) {
    for (let p = 0; p < pages; p++) {
      let batch: PumpCoin[];
      try {
        batch = await fetchCoins({ limit: pageSize, offset: p * pageSize, sort });
      } catch (e) {
        // Do NOT silently break. A rate-limited page used to abort the whole
        // sweep and surface as a clean `updated: 0`, which reads like "nothing
        // changed" rather than "we never looked". Record it and move on; if the
        // ranking is genuinely exhausted, batch.length < pageSize handles it.
        errors.push(`${sort}@${p * pageSize}: ${(e as Error).message}`);
        // A *permanent* failure — pump.fun answering 403 from behind Cloudflare,
        // or a 404 on the ranking — repeats identically on every remaining page
        // and every remaining sort. Continuing to page burns the whole tick on
        // ~20 guaranteed failures, each sitting behind a multi-second Cloudflare
        // challenge; that is what pushed the hourly keeper past its timeout and
        // left it silently dead for weeks. Bail out of the entire sweep so the
        // caller falls straight through to its fallback (Jupiter by mint)
        // instead of waiting on requests that cannot succeed.
        if (isPermanentPumpError(e)) return found;
        break;
      }
      for (const c of batch) {
        if (want.has(c.mint)) found.set(c.mint, c);
      }
      if (batch.length < pageSize) break; // ranking exhausted
      if (found.size === want.size) return found;
      await sleep(350); // pump.fun 429s readily; stay under the limiter
    }
    if (found.size === want.size) break;
  }

  return found;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True when a pump.fun error will repeat on every subsequent request.
 *
 * A 4xx that is not 429 is permanent: Cloudflare's 403 "Just a moment…"
 * challenge, a 404, a 401. 429 and 5xx are transient and worth paging past.
 *
 * `fetchCoins` encodes the status in the message it throws (`pump.fun 403: …`),
 * which is the only structured signal available without widening its return
 * type; the message is already truncated to the status plus 120 body chars.
 */
function isPermanentPumpError(e: unknown): boolean {
  const m = /pump\.fun (\d{3})/.exec((e as Error)?.message ?? "");
  if (!m) return false;
  const status = Number(m[1]);
  return status >= 400 && status < 500 && status !== 429;
}

/**
 * Reader-relay fallback for a Cloudflare-blocked pump.fun page.
 *
 * pump.fun's API sits behind Cloudflare, which now challenges datacenter IPs:
 * both this VPS and the Vercel deployment get `403 Just a moment...` on every
 * request. Without a way round it, new-token ingestion simply stops and the feed
 * freezes on whatever was popular when the block began.
 *
 * The relay fetches the *same URL* from a network Cloudflare does not challenge
 * and returns pump.fun's own JSON, so no gate, mapping or keeper logic changes —
 * this is transport only. It prepends a small header (`Title: … Markdown
 * Content:`) to whatever it fetched; that is stripped and the JSON array parsed
 * out, which is why the body is sliced from the first `[` to the last `]`
 * rather than parsed whole.
 *
 * BUDGETED on purpose. The free tier allows ~20 requests/minute, and a single
 * sweep can page ~20 times, so an unbounded relay would rate-limit itself and
 * take the sweep down with it. The budget is deliberately below the cap; when it
 * is exhausted the relay returns null and the caller falls through to its normal
 * failure path (the sweep then reaches the Jupiter-by-mint fallback). A relay we
 * cannot use is a relay we do not use — never a hang.
 */
const RELAY_BASE = "https://r.jina.ai/";
const RELAY_PER_MIN = 15;
let relayHits: number[] = [];

function relayBudget(): boolean {
  const now = Date.now();
  relayHits = relayHits.filter((t) => now - t < 60_000);
  if (relayHits.length >= RELAY_PER_MIN) return false;
  relayHits.push(now);
  return true;
}

async function fetchViaRelay(url: string): Promise<PumpCoin[] | null> {
  if (!relayBudget()) return null;
  try {
    const res = await fetch(`${RELAY_BASE}${url}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // The relay answers in one of two shapes depending on negotiation, and both
    // carry pump.fun's body intact:
    //   1. a JSON envelope — { code, data: { title, url, content: "<body>" } },
    //      which is what an `Accept: application/json` caller gets; and
    //   2. a read-markdown form — "Title: …\n\nMarkdown Content:\n<body>".
    // Unwrap whichever arrived, then parse the array itself.
    let body = text;
    try {
      const env = JSON.parse(text) as { data?: { content?: unknown } };
      if (typeof env?.data?.content === "string") body = env.data.content;
    } catch {
      const marker = text.indexOf("Markdown Content:");
      if (marker !== -1) body = text.slice(marker + "Markdown Content:".length);
    }
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return null;
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as PumpCoin[]) : null;
  } catch {
    return null;
  }
}

/** Map an API record onto our Coin columns. */
export function toCoinRecord(c: PumpCoin) {
  const vSol = BigInt(Math.round(c.virtual_sol_reserves ?? 0));
  const vTok = BigInt(Math.round(c.virtual_token_reserves ?? 0));
  const supply = BigInt(Math.round(c.total_supply ?? 0));
  const wholeSupply = Number(supply) / 1e6;

  // Once a coin graduates to an AMM, pump.fun stops moving the virtual reserves
  // (they freeze at the "curve filled" sentinel) while `market_cap` keeps
  // tracking the real pool. Deriving price from frozen reserves would paint every
  // graduated coin with the same bogus number, so use the live market cap instead.
  const price =
    c.complete && wholeSupply > 0 && (c.market_cap ?? 0) > 0
      ? (c.market_cap as number) / wholeSupply
      : vTok > 0n
        ? Number(vSol) / 1e9 / (Number(vTok) / 1e6)
        : 0;

  return {
    mint: c.mint,
    name: c.name,
    symbol: c.symbol,
    description: c.description || null,
    imageUrl: c.image_uri || null,
    virtualSol: vSol.toString(),
    virtualToken: vTok.toString(),
    realSol: BigInt(Math.round(c.real_sol_reserves ?? 0)).toString(),
    totalSupply: supply.toString(),
    priceSol: price,
    // Keep market cap *consistent with the price we display*. On the curve all
    // supply circulates, so derived is exact; graduated coins trade in a pool
    // where circulating < total, so the API's figure is the better one.
    marketCapSol: c.complete
      ? (c.market_cap ?? price * wholeSupply)
      : price * wholeSupply,
    complete: Boolean(c.complete),
    poolAddress: c.pool_address || null,
    creator: c.creator || null,
    twitter: c.twitter || null,
    telegram: c.telegram || null,
    website: c.website || null,
    launchedAt: c.created_timestamp ? new Date(c.created_timestamp) : null,
    lastSyncedAt: new Date(),
  };
}

/** Public RPC for read-only balance checks / live-mode plumbing. */
export const SOLANA_RPC =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

/*
 * ---------------------------------------------------------------------------
 * Callout counts
 * ---------------------------------------------------------------------------
 * The feed's rail wants "how many callouts does this coin have" for a handful
 * of coins at a time, so the read has to be cheap. `mint-positions` caps
 * `pageSize` at 50 and does not honour `offset` — paging returns the same rows —
 * so a true total is not reachable. What *is* reachable, in one request, is the
 * page itself: with `withThesis=true` the endpoint returns only rows that carry
 * a callout, so `positions.length` is the callout count exactly, and `hasMore`
 * says whether it was truncated at 50. That is enough for a badge: an exact
 * number under fifty, "50+" above it.
 */

/** The endpoint's own ceiling; asking for more returns an empty body. */
const CALLOUT_COUNT_PAGE = 50;

/** How long a coin's count is reused. The badge is ambient, not a quote. */
const CALLOUT_COUNT_TTL = 60_000;

const calloutCountCache = new Map<string, { n: number; capped: boolean; at: number }>();

/**
 * The number of callouts on one coin, or `null` when the read failed (so a
 * caller can tell "no callouts" from "we could not look").
 */
export async function fetchCalloutCount(
  mint: string,
): Promise<{ n: number; capped: boolean } | null> {
  const hit = calloutCountCache.get(mint);
  if (hit && Date.now() - hit.at < CALLOUT_COUNT_TTL) {
    return { n: hit.n, capped: hit.capped };
  }

  const url = `${FEED_API}/mint-positions/${encodeURIComponent(mint)}?sortBy=LATEST&withThesis=true&pageSize=${CALLOUT_COUNT_PAGE}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(500 + Math.random() * 400);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
      // A coin with no callouts still answers 200 with an empty list; anything
      // else is a genuine failure and must not be cached as a zero.
      if (!res.ok) continue;

      const body = (await res.json()) as {
        positions?: { callout?: { calloutId?: string | null; thesis?: string | null } | null }[];
        hasMore?: boolean;
      };

      // De-dupe by callout id — the same call can appear twice on a boundary.
      const ids = new Set<string>();
      for (const p of body.positions ?? []) {
        const c = p.callout;
        if (c?.calloutId && (c.thesis ?? "").trim()) ids.add(c.calloutId);
      }

      const value = { n: ids.size, capped: Boolean(body.hasMore), at: Date.now() };
      calloutCountCache.set(mint, value);
      return { n: value.n, capped: value.capped };
    } catch {
      /* network blip — try once more, then give up */
    }
  }

  return null;
}

/**
 * Counts for many coins at once, run in small batches so a wall of clips does
 * not open twenty sockets to pump.fun at the same moment. Coins that fail are
 * simply absent from the result — the rail then leaves that badge alone rather
 * than printing a zero it does not believe.
 */
export async function fetchCalloutCounts(
  mints: string[],
): Promise<Record<string, { n: number; capped: boolean }>> {
  const unique = Array.from(new Set(mints.filter(Boolean))).slice(0, 24);
  const out: Record<string, { n: number; capped: boolean }> = {};

  for (let i = 0; i < unique.length; i += 4) {
    const batch = unique.slice(i, i + 4);
    const settled = await Promise.allSettled(batch.map((m) => fetchCalloutCount(m)));
    settled.forEach((r, j) => {
      if (r.status === "fulfilled" && r.value) out[batch[j]] = r.value;
    });
    if (i + 4 < unique.length) await sleep(150);
  }

  return out;
}

/*
 * ---------------------------------------------------------------------------
 * Callouts
 * ---------------------------------------------------------------------------
 * A "callout" is a trader publicly calling a coin they hold, with the note they
 * wrote and the size of their position attached. pump.fun serves the whole set
 * for one coin from `GET /mint-positions/{mint}` on the same public frontend API
 * the rest of this file talks to — no key, no JWT.
 *
 * The two orderings the product exposes are this endpoint's own `sortBy`:
 *   - `TOP`    ranks by the size of what the caller still holds (largest first)
 *   - `LATEST` ranks by when the call was posted (newest first)
 *
 * NOTE: the *global* callout leaderboard / "Hot callouts" rail lives on a
 * different host (`advanced-api-v2.pump.fun`) and is JWT-gated behind a
 * Cloudflare rule that refuses server-side requests outright — it is not
 * reachable from here and is not what this function uses.
 */

type RawCallout = {
  calloutId?: string | null;
  thesis?: string | null;
  mediaUrl?: string | null;
  calloutTimestamp?: string | null;
  calledOutAtMcap?: number | null;
  multiple?: number | null;
  likes?: number | null;
  viewCount?: number | null;
  replyCount?: number | null;
};

type RawMintPosition = {
  userId?: string | null;
  userName?: string | null;
  profileImage?: string | null;
  xUsername?: string | null;
  isVerified?: boolean | null;
  amountHeld?: number | null;
  costBasisUsd?: number | null;
  pnlUsd?: number | null;
  realizedPnlUsd?: number | null;
  pnlPercentage?: number | null;
  callout?: RawCallout | null;
};

/**
 * Fetch the callouts for one coin.
 *
 * Blank-thesis rows are dropped: pump.fun returns a position for every holder
 * whether or not they actually wrote a call, and a callout with no note is just
 * a row of numbers — the note is the thing being read. Rows are also de-duped by
 * callout id, because the same trader can appear twice across a page boundary.
 */
export async function fetchCallouts(
  mint: string,
  opts: { sort?: "top" | "latest"; limit?: number } = {},
): Promise<{ rows: CalloutDTO[]; total: number; hasMore: boolean }> {
  const { sort = "top", limit = 20 } = opts;
  const sortBy = sort === "top" ? "TOP" : "LATEST";
  const url = `${FEED_API}/mint-positions/${encodeURIComponent(mint)}?sortBy=${sortBy}&withThesis=true&pageSize=${limit}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1) + Math.random() * 300);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
      });
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (!res.ok) {
      lastErr = new Error(`pump.fun mint-positions ${res.status}`);
      // 429/5xx are worth another go; a 404 means the coin has no callouts at all.
      if (res.status !== 429 && res.status < 500) break;
      continue;
    }

    const body = (await res.json()) as {
      positions?: RawMintPosition[];
      totalCount?: number;
      hasMore?: boolean;
    };

    const positions = body.positions ?? [];

    /*
     * The coin's current price, derived from the positions themselves.
     *
     * Every row here is the same coin, so `(basis + pnl - realised) / held` is
     * that coin's price in USD — pump.fun exposes no price field on this
     * endpoint, but it exposes the four numbers that imply one. A trader who
     * partially sold leaves a little noise in their own ratio, so take the
     * *median* across the page rather than trusting any single row, then apply
     * that one price to every row. That keeps the size column strictly
     * proportional to what is actually held, which is exactly the ordering the
     * upstream `TOP` sort uses — and, unlike the raw subtraction, it can never
     * come out negative for someone who banked a large realised profit.
     */
    const ratios: number[] = [];
    for (const p of positions) {
      const held = p.amountHeld ?? 0;
      if (held <= 0) continue;
      const v = (p.costBasisUsd ?? 0) + (p.pnlUsd ?? 0) - (p.realizedPnlUsd ?? 0);
      if (v > 0) ratios.push(v / held);
    }
    ratios.sort((a, b) => a - b);
    const priceUsd = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0;

    const seen = new Set<string>();
    const rows: CalloutDTO[] = [];
    for (const p of positions) {
      const c = p.callout;
      const thesis = (c?.thesis ?? "").trim();
      const id = c?.calloutId ?? null;
      if (!c || !id || !thesis || seen.has(id)) continue;
      seen.add(id);

      const cost = p.costBasisUsd ?? 0;
      const pnl = p.pnlUsd ?? 0;
      const realized = p.realizedPnlUsd ?? 0;
      const unrealized = pnl - realized;
      const held = p.amountHeld ?? 0;

      rows.push({
        id,
        author: (p.userName ?? "").trim() || "anon",
        avatarUrl: p.profileImage || null,
        xUsername: p.xUsername || null,
        isVerified: Boolean(p.isVerified),
        thesis,
        mediaUrl: c.mediaUrl || null,
        amountHeld: held,
        // Price-derived when we could read one; the basis identity is the
        // fallback for a page where every row is a partial seller.
        valueUsd: priceUsd > 0 ? held * priceUsd : Math.max(0, cost + unrealized),
        pnlUsd: unrealized,
        // Recomputed from the unrealised figure rather than passed through, so
        // the chip's percentage always agrees with the dollar amount beside it.
        pnlPct: cost > 0 ? (unrealized / cost) * 100 : 0,
        calledOutAtMcap: c.calledOutAtMcap ?? 0,
        multiple: c.multiple ?? 1,
        likes: c.likes ?? 0,
        views: c.viewCount ?? 0,
        replies: c.replyCount ?? 0,
        at: c.calloutTimestamp ?? "",
      });
    }

    return {
      rows,
      total: body.totalCount ?? rows.length,
      hasMore: Boolean(body.hasMore),
    };
  }

  throw lastErr instanceof Error ? lastErr : new Error("pump.fun mint-positions failed");
}

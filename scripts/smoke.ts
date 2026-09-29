/**
 * End-to-end smoke test.
 *
 *   npx tsx scripts/smoke.ts [baseUrl]
 *
 * Reads CRON_SECRET straight from .env so the secret never has to appear in a
 * shell command (where it would get redacted and silently break the test).
 * Exercises: every page, the cron auth gate, and a real practice round-trip.
 */
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3000";

function env(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const m = raw.match(new RegExp(`^${key}="?([^"\\n]*)"?`, "m"));
    return m?.[1];
  } catch {
    return undefined;
  }
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log(`smoke test → ${BASE}\n`);

  console.log("pages");
  for (const p of [
    "/",
    "/coins",
    "/account",
    "/portfolio",
    "/favorites",
    "/search",
    "/notifications",
    "/legal/terms",
    "/legal/privacy",
  ]) {
    const r = await fetch(`${BASE}${p}`);
    check(p, r.ok, `${r.status}`);
  }

  // The favourites page is login-gated in its content, but the route itself must
  // render logged-out — it explains what the star does and offers the login.
  const favHtml = await (await fetch(`${BASE}/favorites`)).text();
  check(
    "favorites page renders its real content",
    favHtml.includes("Favourites") && favHtml.includes("Save clips as you scroll"),
    `${favHtml.length}b`,
  );

  // The bottom bar is icons-only with five tabs now. Assert on the accessible
  // labels, since the visible text is deliberately just glyphs.
  const home = await (await fetch(`${BASE}/`)).text();
  check(
    "bottom nav has five labelled tabs",
    ["Feed", "Coins", "Upload", "Favourites", "Account"].every((l) =>
      home.includes(`aria-label="${l}"`),
    ),
  );

  // The nav draws real SVG line icons, not emoji. Emoji render differently on
  // every platform and cannot inherit `currentColor`, so the active-tab colour
  // silently stops working — this guards against that regression coming back.
  check(
    "nav icons are inline SVG with currentColor strokes",
    (home.match(/stroke="currentColor"/g) ?? []).length >= 5,
    `${(home.match(/stroke="currentColor"/g) ?? []).length} stroked icons`,
  );
  check(
    "no emoji glyphs in the server-rendered UI",
    !/(❤️|🤍|💬|🔊|🔇)/u.test(home),
  );

  // The welcome screen. It must be offered to a first-time visitor and withheld
  // from one who has already dismissed it — and the decision has to happen in the
  // server render, which is why the cookie is sent with the request rather than
  // being applied by client script after the fact.
  console.log("\nlanding");
  check(
    "a first-time visitor is served the welcome screen",
    home.includes("Where clips") && home.includes("Just watch"),
  );
  check(
    "the welcome screen offers login, not wallet-connect",
    home.includes(">Login<") || home.includes("Login\n"),
    "button label",
  );
  const returning = await (
    await fetch(`${BASE}/`, { headers: { cookie: "pumpclip_welcome=1" } })
  ).text();
  check(
    "a returning visitor is not served the welcome screen",
    !returning.includes("Just watch") && returning.includes("aria-label=\"Feed\""),
    `${returning.length}b`,
  );
  // The mosaic is real artwork, not placeholder blocks: every tile must be
  // pulling from a catalogue URL. A wall of gradients would mean the fetch that
  // fills it is broken and nobody noticed.
  check(
    "the mosaic is filled with real token art",
    /class="[^"]*object-cover/.test(home),
    "has tile imagery",
  );

  // The account page is where wallet management, the live book and sign-out now
  // live; the old modal sheet and the /portfolio tab are gone. /portfolio is
  // kept only as a redirect, so a stale bookmark still lands somewhere useful.
  //
  // Assert on positive markers, never on the absence of "This page could not be
  // found": Next ships its not-found boundary inside the RSC flight payload of
  // every page, so that string is present even on a perfectly good route.
  const acctHtml = await (await fetch(`${BASE}/account`)).text();
  check(
    "account page renders its real content",
    acctHtml.includes(">Account<") && acctHtml.includes("Sign in to trade"),
    `${acctHtml.length}b`,
  );

  const pf = await fetch(`${BASE}/portfolio`, { redirect: "manual" });
  const loc = pf.headers.get("location") ?? "";
  check(
    "/portfolio redirects to /account",
    (pf.status === 307 || pf.status === 308 || pf.status === 302 || pf.status === 301) &&
      loc.includes("/account"),
    `${pf.status} → ${loc || "no location"}`,
  );

  // The legal docs must actually render their substance, not just return 200.
  const termsHtml = await (await fetch(`${BASE}/legal/terms`)).text();
  check(
    "terms page renders its risk disclosure",
    termsHtml.includes("total and irreversible loss"),
    termsHtml.includes("Terms of Service") ? "found" : "missing heading",
  );
  const privHtml = await (await fetch(`${BASE}/legal/privacy`)).text();
  check(
    "privacy page states we never hold keys",
    /never receive, store, transmit/i.test(privHtml),
    privHtml.includes("Privacy Policy") ? "found" : "missing heading",
  );

  console.log("\ncron gate");
  const noAuth = await fetch(`${BASE}/api/sync?limit=1`);
  check("GET /api/sync without bearer is rejected", noAuth.status === 401, `${noAuth.status}`);

  const badAuth = await fetch(`${BASE}/api/sync?limit=1`, {
    headers: { authorization: "Bearer definitely-not-the-secret" },
  });
  check("GET /api/sync with wrong bearer is rejected", badAuth.status === 401, `${badAuth.status}`);

  const secret = env("CRON_SECRET");
  if (!secret) {
    check("CRON_SECRET present in env", false, "not found");
  } else {
    const ok = await fetch(`${BASE}/api/sync?limit=12`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = (await ok.json()) as {
      ok?: boolean;
      checked?: number;
      updated?: number;
      notFound?: number;
    };
    check("GET /api/sync with correct bearer succeeds", ok.ok === true, `${ok.status}`);
    // The whole point of this test: a keeper that returns ok but updates nothing
    // is broken, and that is exactly how it failed before.
    check(
      "keeper actually updated something",
      (body.updated ?? 0) > 0,
      `checked=${body.checked} updated=${body.updated} notFound=${body.notFound}`,
    );
  }

  console.log("\nfeed");
  const feedRes = await fetch(`${BASE}/api/feed?limit=3`);
  const feed = (await feedRes.json()) as {
    items: {
      id: string;
      coin: {
        mint: string;
        symbol: string;
        launchedAt: string | null;
        createdAt: string | null;
        volatility5m?: number;
        marketCapSol: number;
      };
      videoUrl: string | null;
      thumbUrl: string | null;
      position: unknown;
    }[];
    total: number;
  };
  check("feed returns items", feed.items.length > 0, `${feed.total} clips`);

  // A clip is servable if it has a video OR art. A freshly ingested token is
  // deliberately art-only until the renderer catches up (see lib/ingest.ts), so
  // asserting "every clip has a video" would fail on a working system — and
  // worse, it would fail *because* ingestion is doing its job.
  check(
    "every feed item is renderable (video or art)",
    feed.items.every((it) => Boolean(it.videoUrl || it.thumbUrl)),
    feed.items.map((it) => (it.videoUrl ? "video" : "art")).join(","),
  );

  // Verify the asset, whichever kind it is.
  const first = feed.items[0];
  if (first?.videoUrl) {
    const vid = await fetch(`${BASE}${first.videoUrl}`);
    check("clip asset is served", vid.ok, `${vid.status} ${vid.headers.get("content-type")}`);
  }
  if (first?.thumbUrl && !first.videoUrl) {
    const art = await fetch(first.thumbUrl);
    check(
      "art-only clip serves its art",
      art.ok,
      `${art.status} ${art.headers.get("content-type")}`,
    );
  }

  // Every item must carry the key even when nobody is holding — the feed colours
  // a clip against the viewer's entry price, and `undefined` vs `null` is the
  // difference between "no position" and "the field was never serialised".
  check(
    "feed serialises a position field on every item",
    feed.items.every((it) => "position" in it),
    feed.items.map((it) => (it.position ? "held" : "none")).join(","),
  );

  // Token age rides on `createdAt` (with `launchedAt` preferred when pump.fun
  // supplied it). If it were missing the age chip would render "— old", so this
  // is the check that keeps the age honest.
  console.log("\ntoken age + hot/top ranking");
  check(
    "every feed coin carries an age (createdAt, or launchedAt)",
    feed.items.every((it) => Boolean(it.coin.launchedAt || it.coin.createdAt)),
    feed.items.map((it) => it.coin.launchedAt ?? it.coin.createdAt ?? "MISSING").slice(0, 1).join(""),
  );

  // Hot is a gainers board: ordered by the 5-minute change, descending, and
  // gated to coins that are actually up. If the gate matches nothing the feed
  // falls back to the ranked catalog, in which case every item is unmeasured —
  // a *mix* is the shape a broken filter would produce and is what this fails on.
  const hotRes = await fetch(`${BASE}/api/feed?sort=hot&limit=8`);
  const hot = (await hotRes.json()) as {
    items: { coin: { change5mPct?: number } }[];
    total: number;
  };
  check("hot feed returns items", hot.items.length > 0, `${hot.total} clips`);
  const hotChg = hot.items.map((it) => it.coin.change5mPct ?? 0);
  check(
    "hot feed is ordered by 5-minute increase (descending)",
    hotChg.every((v, i) => i === 0 || hotChg[i - 1] >= v),
    hotChg.map((v) => `${v.toFixed(2)}%`).join(" ≥ "),
  );
  const hotUp = hotChg.filter((v) => v > 0).length;
  check(
    "hot feed is a gainers board — all up, or fully ungated",
    hotUp === 0 || hotUp === hotChg.length,
    `${hotUp}/${hotChg.length} up over 5m`,
  );

  // New is new *tokens*: launched within the last 30 minutes, newest first. Same
  // all-or-nothing rule when the window is empty.
  const newRes = await fetch(`${BASE}/api/feed?sort=new&limit=8`);
  const newFeed = (await newRes.json()) as {
    items: { coin: { launchedAt: string | null; createdAt: string | null } }[];
    total: number;
  };
  check("new feed returns items", newFeed.items.length > 0, `${newFeed.total} clips`);
  const ageOf = (it: (typeof newFeed.items)[number]) =>
    new Date(it.coin.launchedAt ?? it.coin.createdAt ?? 0).getTime();
  // Tolerance covers the fallback firing, plus the gap between the request and
  // this assertion.
  const freshCut = Date.now() - 30 * 60_000 - 120_000;
  const fresh = newFeed.items.filter((it) => ageOf(it) >= freshCut).length;
  check(
    "new feed is all-fresh tokens or fully ungated — never a mix",
    fresh === 0 || fresh === newFeed.items.length,
    `${fresh}/${newFeed.items.length} launched in the last 30m`,
  );

  const topRes = await fetch(`${BASE}/api/feed?sort=top&limit=8`);
  const topFeed = (await topRes.json()) as {
    items: { coin: { marketCapSol: number } }[];
    total: number;
    solUsd: number;
  };
  check("top feed returns items", topFeed.items.length > 0, `${topFeed.total} clips`);
  const topCaps = topFeed.items.map((it) => it.coin.marketCapSol);
  check(
    "top feed is ordered by market cap (descending)",
    topCaps.every((v, i) => i === 0 || topCaps[i - 1] >= v),
    topCaps.map((v) => Math.round(v)).join(" ≥ "),
  );
  // $100k floor, evaluated in USD because market caps are stored in SOL. A small
  // tolerance absorbs the SOL/USD cache changing between the two requests.
  const topUsd = topFeed.solUsd || 1;
  check(
    "every top-feed coin is at $100k market cap or above",
    topCaps.every((mc) => mc * topUsd >= 99_000),
    topCaps.map((mc) => `$${Math.round((mc * topUsd) / 1000)}k`).join(", "),
  );

  // Regression for the reason uploaded clips were invisible.
  //
  // The shuffled wall pages through a *pool* of clips, and `total` advertises how
  // deep that wall is. When the pool was capped below the advertised total, the
  // tail was unreachable: asking for the last page returned nothing, while the
  // feed still claimed those clips existed. Any clip below the ranked cut — which
  // was every user upload — could never be served, and nothing in the API said
  // so. The page at `total - 3` must therefore return something.
  const deepSeed = "smoke-deep-pool";
  const probe = (await (await fetch(`${BASE}/api/feed?limit=3&seed=${deepSeed}`)).json()) as {
    total: number;
  };
  const deepOffset = Math.max(0, probe.total - 3);
  const deep = (await (
    await fetch(`${BASE}/api/feed?limit=3&offset=${deepOffset}&seed=${deepSeed}`)
  ).json()) as { items: { id: string }[] };
  check(
    "the tail of the shuffled wall is reachable (pool covers what total claims)",
    probe.total <= 3 || deep.items.length > 0,
    `total=${probe.total}, offset=${deepOffset} → ${deep.items.length} items`,
  );

  console.log("\nlive quotes");
  const qMints = feed.items.map((it) => it.coin.mint);
  const qRes = await fetch(`${BASE}/api/quotes?mints=${qMints.join(",")}`);
  const qBody = (await qRes.json()) as {
    quotes: Record<string, { priceSol: number; marketCapSol: number; change24hPct: number; live: boolean }>;
  };
  check("quotes route responds", qRes.ok, `${qRes.status}`);
  const quoted = Object.values(qBody.quotes ?? {});
  check(
    "quotes covers the feed's mints",
    quoted.length > 0,
    `${quoted.length}/${qMints.length} answered`,
  );
  // A zero or NaN price would render as "—" or, worse, colour a holding green by
  // accident. Every quote that comes back has to be a real positive number.
  check(
    "every quote is a positive finite price",
    quoted.every((q) => Number.isFinite(q.priceSol) && q.priceSol > 0),
  );
  check(
    "every quote has a positive market cap",
    quoted.every((q) => Number.isFinite(q.marketCapSol) && q.marketCapSol > 0),
  );
  // Junk in must not 500 the ticker. The route filters to plausible mints and
  // answers an empty map rather than erroring.
  const qJunk = await fetch(`${BASE}/api/quotes?mints=not-a-mint,also-not-one,%%%`);
  const qJunkBody = (await qJunk.json()) as { quotes: Record<string, unknown> };
  check(
    "junk mints are ignored, not an error",
    qJunk.ok && Object.keys(qJunkBody.quotes ?? {}).length === 0,
    `${qJunk.status}`,
  );

  // The feed is shuffled per session. These three assertions are what make the
  // shuffle safe to ship: it must be *stable* for a given seed (or paging would
  // repeat and skip clips) and yet actually differ across seeds (or it isn't a
  // shuffle at all). A single "shuffle works" check would pass with
  // `ORDER BY random()`, which is precisely the bug being guarded against.
  console.log("\nfeed shuffle");
  const seedA = "smoke-seed-aaaa";
  const seedB = "smoke-seed-bbbb";
  // The client sends a pool cutoff alongside the seed (see components/Feed.tsx):
  // the seed fixes the order, the cutoff fixes the contents. Both are needed for
  // the paging guarantee, so the test exercises them the way the app does.
  const since = String(Date.now());
  const ids = (j: { items: { id: string }[] }) => j.items.map((i) => i.id).join(",");

  const a1 = (await (await fetch(`${BASE}/api/feed?limit=3&seed=${seedA}&since=${since}`)).json()) as {
    items: { id: string }[];
  };
  const a1again = (await (
    await fetch(`${BASE}/api/feed?limit=3&seed=${seedA}&since=${since}`)
  ).json()) as { items: { id: string }[] };
  check(
    "same seed and pool cutoff returns an identical order",
    ids(a1) === ids(a1again),
    ids(a1).slice(0, 40),
  );

  const a2 = (await (
    await fetch(`${BASE}/api/feed?limit=3&offset=3&seed=${seedA}&since=${since}`)
  ).json()) as { items: { id: string }[] };
  const overlap = a2.items.filter((x) => a1.items.some((y) => y.id === x.id));
  check(
    "page 2 of a shuffled feed repeats nothing from page 1",
    a1.items.length > 0 && overlap.length === 0,
    `overlap ${overlap.length}`,
  );

  const b1 = (await (await fetch(`${BASE}/api/feed?limit=12&seed=${seedB}&since=${since}`)).json()) as {
    items: { id: string }[];
  };
  const aWide = (await (await fetch(`${BASE}/api/feed?limit=12&seed=${seedA}&since=${since}`)).json()) as {
    items: { id: string }[];
  };
  check(
    "a different seed produces a different order",
    aWide.items.length > 1 && ids(aWide) !== ids(b1),
  );

  // The cutoff has to actually exclude clips, not just sit in the URL. A cutoff
  // in 2001 predates every clip in the catalog, so the pool must come back empty.
  const ancient = (await (
    await fetch(`${BASE}/api/feed?limit=3&seed=${seedA}&since=1000000000001`)
  ).json()) as { items: { id: string }[] };
  check(
    "a pool cutoff that predates the catalog excludes every clip",
    ancient.items.length === 0,
    `${ancient.items.length} items`,
  );

  console.log("\nfavourites");
  const favPost = await fetch(`${BASE}/api/clips/${first.id}/favorite`, { method: "POST" });
  check("saving requires login", favPost.status === 401, `${favPost.status}`);
  const favList = await fetch(`${BASE}/api/favorites`);
  check("the saved list requires login", favList.status === 401, `${favList.status}`);
  const favBadClip = await fetch(`${BASE}/api/clips/does-not-exist/favorite`, {
    method: "POST",
  });
  check(
    "an anonymous save cannot probe whether a clip exists",
    favBadClip.status === 401,
    `${favBadClip.status}`,
  );

  const jar = new Map<string, string>();
  const remember = (r: Response) => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      jar.set(k, v);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  const mint = feed.items[0].coin.mint;
  const clipId = feed.items[0].id;

  console.log("\npractice trading is gone");
  // The simulated engine was removed. This route must not exist at all — a
  // remnant would let someone "fill" a trade that never touched the chain.
  const gone = await fetch(`${BASE}/api/trade`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mint, side: "BUY", solAmount: 0.5 }),
  });
  // Next serves unmatched paths through its not-found handler, which can answer
  // 200 with an HTML body rather than a 404 — so a bare status check reads as a
  // false failure. The routing signal is x-matched-path: /_not-found.
  const matched = gone.headers.get("x-matched-path") ?? "";
  const isNotFound = matched === "/_not-found" || gone.status === 404 || gone.status === 405;
  check(
    "POST /api/trade no longer exists",
    isNotFound,
    `${gone.status}${matched ? ` (x-matched-path: ${matched})` : ""}`,
  );

  console.log("\nengagement is real and login-gated");
  const like = await fetch(`${BASE}/api/clips/${clipId}/like`, {
    method: "POST",
    headers: { cookie: cookie() },
  });
  check("like without a session is rejected", like.status === 401, `${like.status}`);

  const commentPost = await fetch(`${BASE}/api/clips/${clipId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify({ body: "gm" }),
  });
  check("comment without a session is rejected", commentPost.status === 401, `${commentPost.status}`);

  const commentList = await fetch(`${BASE}/api/clips/${clipId}/comments`);
  const commentBody = (await commentList.json()) as { comments?: unknown[] };
  check(
    "comments list is publicly readable",
    commentList.ok && Array.isArray(commentBody.comments),
    `${commentBody.comments?.length ?? "?"} comments`,
  );

  console.log("\nuploads are login-gated");
  const presign = await fetch(`${BASE}/api/uploads/presign`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify({ contentType: "video/mp4", sizeBytes: 1024 * 1024 }),
  });
  check("upload presign without a session is rejected", presign.status === 401, `${presign.status}`);

  console.log("\nlive trading boundary");

  // The real live path exists, and is closed to anonymous callers.
  const prep = await fetch(`${BASE}/api/trade/live/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mint, side: "BUY", solAmount: 0.1 }),
  });
  check(
    "live prepare without a session is rejected",
    prep.status === 401 || prep.status === 503,
    `${prep.status}`,
  );

  const conf = await fetch(`${BASE}/api/trade/live/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mint, side: "BUY", signature: "5".repeat(64) }),
  });
  check(
    "live confirm without a session is rejected",
    conf.status === 401 || conf.status === 503,
    `${conf.status}`,
  );

  // A live prepare that IS authenticated but isn't a real wallet must not build
  // anything either — the trader has no wallet bound.
  const prepAnon = await fetch(`${BASE}/api/trade/live/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify({ mint, side: "BUY", solAmount: 0.1 }),
  });
  check(
    "live prepare for a wallet-less trader is refused",
    prepAnon.status === 401 || prepAnon.status === 409 || prepAnon.status === 503,
    `${prepAnon.status}`,
  );

  console.log("\nprivy auth boundary");
  // A token that merely *claims* a user must never be accepted. `alg: none` is
  // the classic bypass — if this ever passes, anyone can become anyone.
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({
    sub: "did:privy:forged-attacker",
    iss: "privy.io",
    aud: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmuma0xbm00fy0dl9e804rf1u",
    exp: 9999999999,
  })}.`;

  const post = (body: unknown) =>
    fetch(`${BASE}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const forgedRes = await post({ accessToken: forged });
  check("forged alg=none JWT is rejected", forgedRes.status === 401, `${forgedRes.status}`);
  const garbageRes = await post({ accessToken: "not-a-jwt" });
  check("garbage token is rejected", garbageRes.status === 401, `${garbageRes.status}`);
  const emptyRes = await post({});
  check("missing token is rejected", emptyRes.status === 401, `${emptyRes.status}`);

  const wd = await fetch(`${BASE}/api/wallet/withdraw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: "11111111111111111111111111111112", amountSol: 1 }),
  });
  check("withdraw without a session is rejected", wd.status === 401, `${wd.status}`);

  const bal = await fetch(
    `${BASE}/api/wallet/balance?address=So11111111111111111111111111111111111111112`,
  );
  const balBody = (await bal.json()) as { sol?: number };
  check("balance route returns a live figure", bal.ok && Number.isFinite(balBody.sol), `${balBody.sol} SOL`);

  const balBad = await fetch(`${BASE}/api/wallet/balance?address=not-a-key`);
  check("balance rejects a bad pubkey", balBad.status === 400, `${balBad.status}`);

  console.log("\nsocial graph");

  // Everything that changes the graph requires a verified identity. A cookie
  // alone would let a script inflate follower counts and spam inboxes.
  for (const [label, path, body] of [
    ["follow", "/api/follow", { traderId: "someone" }],
    ["token follow", "/api/token-follow", { mint: "So11111111111111111111111111111111111111112" }],
    ["mark notifications", "/api/notifications", { all: true }],
  ] as const) {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    check(`${label} without a session is rejected`, r.status === 401, `${r.status}`);
  }

  const notes = await fetch(`${BASE}/api/notifications`);
  check("the inbox requires a session", notes.status === 401, `${notes.status}`);

  const acctPatch = await fetch(`${BASE}/api/account`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "smoketest" }),
  });
  check("claiming a handle requires a session", acctPatch.status === 401, `${acctPatch.status}`);

  // The session handle IS the cookie value. It must never come back in a JSON
  // payload, or the httpOnly flag on the cookie stops meaning anything.
  const acct = await fetch(`${BASE}/api/account`);
  const acctBody = (await acct.json()) as { trader?: Record<string, unknown> };
  check(
    "the account payload does not leak the session handle",
    Boolean(acctBody.trader) && !("handle" in (acctBody.trader ?? {})),
    Object.keys(acctBody.trader ?? {}).join(","),
  );

  const searchShape = await fetch(`${BASE}/api/search?q=sol`);
  const searchBody = (await searchShape.json()) as {
    users?: unknown[];
    tokens?: { symbol?: string }[];
  };
  check(
    "search returns both people and tokens",
    searchShape.ok && Array.isArray(searchBody.users) && Array.isArray(searchBody.tokens),
    `${searchBody.users?.length ?? 0} users / ${searchBody.tokens?.length ?? 0} tokens`,
  );

  // A known token must actually be findable by symbol — the search is only
  // useful if an obviously-correct query returns the thing.
  const knownSymbol = feed.items[0]?.coin.symbol ?? "";
  const bySymbol = (await (
    await fetch(`${BASE}/api/search?q=${encodeURIComponent(knownSymbol)}`)
  ).json()) as { tokens?: { symbol?: string }[] };
  check(
    "search finds a token by its own symbol",
    (bySymbol.tokens ?? []).some((t) => t.symbol === knownSymbol),
    `looked for ${knownSymbol}`,
  );

  // Handles are 37 characters, so a username (max 20) can never be one. If a
  // session handle ever resolved as a profile, a leaked cookie string would
  // become a way to enumerate accounts.
  const handleLookup = await fetch(`${BASE}/api/users/anon-${"a".repeat(32)}`);
  check("a session handle does not resolve as a profile", handleLookup.status === 404, `${handleLookup.status}`);

  const ghost = await fetch(`${BASE}/api/users/nobody-here-at-all`);
  check("an unknown profile is a clean 404", ghost.status === 404, `${ghost.status}`);

  const emptyQ = (await (await fetch(`${BASE}/api/search?q=`)).json()) as {
    users?: unknown[];
    tokens?: unknown[];
  };
  check(
    "an empty query returns nothing rather than everything",
    (emptyQ.users ?? []).length === 0 && (emptyQ.tokens ?? []).length === 0,
  );

  // `%` and `_` are LIKE wildcards, and Prisma's `contains` does not escape
  // them — so before this was guarded, a search for "%" returned the entire
  // catalogue. They must now match literally, i.e. return nothing.
  const wild = await fetch(`${BASE}/api/search?q=${encodeURIComponent("%%%")}`);
  const wildBody = (await wild.json()) as { users?: unknown[]; tokens?: unknown[] };
  check(
    "LIKE wildcards in a query are matched literally, not as wildcards",
    wild.ok && (wildBody.tokens ?? []).length === 0 && (wildBody.users ?? []).length === 0,
    `${wildBody.tokens?.length ?? "?"} tokens`,
  );

  // The Following wall must NOT silently fall back to the global feed. An
  // anonymous viewer follows nobody, so an honest answer is an empty list — a
  // populated one would mean the toggle is lying about what it shows.
  const followingWall = await fetch(`${BASE}/api/feed?limit=5&scope=following&seed=x&since=${Date.now()}`);
  const followingBody = (await followingWall.json()) as { items?: unknown[] };
  check(
    "the Following wall is empty for a viewer who follows nobody",
    followingWall.ok && (followingBody.items ?? []).length === 0,
    `${followingBody.items?.length ?? "?"} items`,
  );

  // The coin detail must report the public name, not the session handle.
  const coinDetail = await fetch(`${BASE}/api/coins/${encodeURIComponent(knownSymbol)}`);
  const coinBody = (await coinDetail.json()) as {
    trades?: { who?: string; handle?: string }[];
    following?: unknown;
  };
  check(
    "coin detail exposes trade authors by public name, not handle",
    coinDetail.ok && (coinBody.trades ?? []).every((t) => t.handle === undefined && "who" in t),
    `${coinBody.trades?.length ?? 0} trades`,
  );
  check(
    "coin detail reports the viewer's token-follow state",
    typeof coinBody.following === "boolean",
    String(coinBody.following),
  );

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

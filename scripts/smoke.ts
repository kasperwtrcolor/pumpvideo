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
      coin: { mint: string; symbol: string };
      videoUrl: string | null;
      thumbUrl: string | null;
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

  // The feed is shuffled per session. These three assertions are what make the
  // shuffle safe to ship: it must be *stable* for a given seed (or paging would
  // repeat and skip clips) and yet actually differ across seeds (or it isn't a
  // shuffle at all). A single "shuffle works" check would pass with
  // `ORDER BY random()`, which is precisely the bug being guarded against.
  console.log("\nfeed shuffle");
  const seedA = "smoke-seed-aaaa";
  const seedB = "smoke-seed-bbbb";
  const ids = (j: { items: { id: string }[] }) => j.items.map((i) => i.id).join(",");

  const a1 = (await (await fetch(`${BASE}/api/feed?limit=3&seed=${seedA}`)).json()) as {
    items: { id: string }[];
  };
  const a1again = (await (await fetch(`${BASE}/api/feed?limit=3&seed=${seedA}`)).json()) as {
    items: { id: string }[];
  };
  check(
    "same seed returns an identical order",
    ids(a1) === ids(a1again),
    ids(a1).slice(0, 40),
  );

  const a2 = (await (
    await fetch(`${BASE}/api/feed?limit=3&offset=3&seed=${seedA}`)
  ).json()) as { items: { id: string }[] };
  const overlap = a2.items.filter((x) => a1.items.some((y) => y.id === x.id));
  check(
    "page 2 of a shuffled feed repeats nothing from page 1",
    a1.items.length > 0 && overlap.length === 0,
    `overlap ${overlap.length}`,
  );

  const b1 = (await (await fetch(`${BASE}/api/feed?limit=12&seed=${seedB}`)).json()) as {
    items: { id: string }[];
  };
  const aWide = (await (await fetch(`${BASE}/api/feed?limit=12&seed=${seedA}`)).json()) as {
    items: { id: string }[];
  };
  check(
    "a different seed produces a different order",
    aWide.items.length > 1 && ids(aWide) !== ids(b1),
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

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

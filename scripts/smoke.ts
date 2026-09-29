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
  for (const p of ["/", "/coins", "/portfolio"]) {
    const r = await fetch(`${BASE}${p}`);
    check(p, r.ok, `${r.status}`);
  }

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
    items: { coin: { mint: string; symbol: string }; videoUrl: string }[];
    total: number;
  };
  check("feed returns items", feed.items.length > 0, `${feed.total} clips`);
  check("feed items carry a video url", Boolean(feed.items[0]?.videoUrl));

  if (feed.items[0]?.videoUrl) {
    const vid = await fetch(`${BASE}${feed.items[0].videoUrl}`);
    check("clip asset is served", vid.ok, `${vid.status} ${vid.headers.get("content-type")}`);
  }

  console.log("\npractice round-trip");
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
  const buy = await fetch(`${BASE}/api/trade`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify({ mint, side: "BUY", solAmount: 0.5 }),
  });
  remember(buy);
  const buyBody = (await buy.json()) as {
    ok?: boolean;
    tokensOut?: number;
    trader?: { practiceBalance: number };
  };
  check("BUY succeeds", buyBody.ok === true, `${buyBody.tokensOut?.toFixed(0)} tokens`);
  check(
    "balance decremented",
    buyBody.trader?.practiceBalance === 99.5,
    `bal=${buyBody.trader?.practiceBalance}`,
  );

  const sell = await fetch(`${BASE}/api/trade`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify({ mint, side: "SELL", fraction: 1 }),
  });
  remember(sell);
  const sellBody = (await sell.json()) as {
    ok?: boolean;
    solOut?: number;
    trader?: { practiceBalance: number };
  };
  check("SELL succeeds", sellBody.ok === true, `${sellBody.solOut?.toFixed(6)} SOL out`);
  // Round trip must cost ~2% (1% each way). Bigger means the curve is wrong.
  const cost = 0.5 - (sellBody.solOut ?? 0);
  check(
    "round-trip cost is ~2% (fee both ways)",
    cost > 0 && cost < 0.5 * 0.04,
    `lost ${cost.toFixed(6)} SOL (${((cost / 0.5) * 100).toFixed(2)}%)`,
  );

  console.log("\nlive mode must refuse");
  const live = await fetch(`${BASE}/api/trade`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify({ mint, side: "BUY", solAmount: 1, mode: "LIVE" }),
  });
  check("LIVE fill returns 501, never a fake tx", live.status === 501, `${live.status}`);

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

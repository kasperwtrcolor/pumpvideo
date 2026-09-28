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

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

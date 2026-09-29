/**
 * Apply the bucket's CORS policy.
 *
 *   ./scripts/with-firebase-env.sh npx tsx scripts/set-cors.ts
 *   ./scripts/with-firebase-env.sh npx tsx scripts/set-cors.ts https://example.com
 *
 * Run this after any origin change (a rename, a new preview domain) — the list
 * is exact-match, so a domain that is missing is a browser upload that fails
 * with no server-side trace. It is deliberately not wired into the deploy: CORS
 * is a property of the bucket, not of the build, and PATCHing it on every push
 * would give a shared bucket a deploy-cadence dependency it does not want.
 *
 * The final self-check is the point of the script. It re-runs the exact
 * preflight a browser sends, including our signed metadata header, and fails
 * loudly if GCS answers without Access-Control-Allow-Origin — the state that
 * breaks uploads only in a browser.
 */
import { setBucketCors, storageBucket, UPLOAD_META_HEADER } from "@/lib/gcs";

const DEFAULT_ORIGINS = [
  "https://pumpvideo.vercel.app",
  "https://pumpclip.vercel.app",
  "http://localhost:3000",
];

(async () => {
  const origins = process.argv.slice(2).filter(Boolean);
  const list = origins.length > 0 ? origins : DEFAULT_ORIGINS;
  const bucket = storageBucket();

  if (!bucket) {
    console.error("no FIREBASE_STORAGE_BUCKET — run this via scripts/with-firebase-env.sh");
    process.exit(1);
  }

  console.log(`bucket:  ${bucket}`);
  console.log(`origins: ${list.join(", ")}`);

  const applied = await setBucketCors(list);
  if (!applied.ok) {
    console.error(`\nFAILED to set CORS: ${applied.detail}`);
    process.exit(1);
  }
  console.log("cors:    applied");

  // Verify with the real preflight, not by reading the config back.
  const url = `https://storage.googleapis.com/${bucket}/clips/cors-probe/p.mp4`;
  let failures = 0;

  for (const origin of list) {
    const res = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": `content-type,${UPLOAD_META_HEADER}`,
      },
    });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    const ok = allowOrigin === origin && allowHeaders.includes(UPLOAD_META_HEADER);
    if (!ok) failures++;
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${origin}  allow-origin=${allowOrigin ?? "—"}  allow-headers=${allowHeaders || "—"}`,
    );
  }

  // An origin that is not on the list must NOT be allowed — otherwise the list
  // is decorative and any site can drive uploads at this bucket.
  const alien = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: "https://not-our-origin.example",
      "Access-Control-Request-Method": "PUT",
    },
  });
  const alienAllowed = alien.headers.get("access-control-allow-origin");
  const alienOk = alienAllowed === null;
  if (!alienOk) failures++;
  console.log(`  ${alienOk ? "OK  " : "FAIL"} unknown origin is refused (allow-origin=${alienAllowed ?? "—"})`);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed — browser uploads will be blocked.`);
    process.exit(1);
  }
  console.log("\nALL PASS — browser uploads to this bucket are permitted.");
  process.exit(0);
})();

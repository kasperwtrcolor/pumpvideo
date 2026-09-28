/**
 * Pre-push secret scan.
 *
 *   npx tsx scripts/scan-secrets.ts
 *
 * Reads real secret values out of .env, then greps every tracked file for them.
 * This exists because scanning from a shell command means the secret appears in
 * the command line — where it gets redacted, silently turning the check into a
 * no-op that always reports "clean".
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    /* no .env — nothing to check */
  }
  return out;
}

/** Values worth leak-checking: pull them out of connection strings too. */
function secretsFrom(env: Record<string, string>): { name: string; value: string }[] {
  const found: { name: string; value: string }[] = [];

  const cron = env.CRON_SECRET;
  if (cron && cron.length >= 12) found.push({ name: "CRON_SECRET", value: cron });

  // A *keyed* RPC endpoint is a secret; the public mainnet URL is not — it is
  // literally the hardcoded fallback in lib/pumpfun.ts, so flagging it is noise
  // that trains you to ignore this scanner.
  const rpc = env.SOLANA_RPC_URL ?? "";
  const isPublicRpc = /api\.mainnet-beta\.solana\.com/.test(rpc);
  if (rpc && !isPublicRpc && rpc.length >= 12) {
    found.push({ name: "SOLANA_RPC_URL (keyed)", value: rpc });
  }

  // postgresql://user:password@host/db
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    const v = env[key] ?? "";
    const m = v.match(/:\/\/[^:]+:([^@]+)@/);
    if (m && m[1].length >= 6 && !/^\*+$/.test(m[1])) {
      found.push({ name: `${key} password`, value: m[1] });
    }
  }
  return found;
}

function main() {
  const env = loadEnv();
  const secrets = secretsFrom(env);
  const files = execSync("git ls-files", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  console.log(`scanning ${files.length} tracked files for ${secrets.length} secrets\n`);

  if (secrets.length === 0) {
    console.log("no secret values found in .env — nothing to scan for");
    return;
  }

  let leaks = 0;
  for (const { name, value } of secrets) {
    let hits = 0;
    for (const f of files) {
      let body: string;
      try {
        body = readFileSync(f, "utf8");
      } catch {
        continue; // binary (mp4/jpg) — can't contain a text secret
      }
      if (body.includes(value)) {
        console.log(`  LEAK  ${name} appears in ${f}`);
        hits++;
        leaks++;
      }
    }
    console.log(`  ${hits === 0 ? "OK  " : "FAIL"}  ${name} — ${hits} file(s)`);
  }

  console.log(`\n${leaks === 0 ? "CLEAN — safe to push" : `${leaks} LEAK(S) — DO NOT PUSH`}`);
  process.exit(leaks === 0 ? 0 : 1);
}

main();

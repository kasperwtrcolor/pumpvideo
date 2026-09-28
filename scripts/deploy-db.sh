#!/usr/bin/env bash
# Wire a *remote* Postgres (Neon via Vercel Marketplace) to this app.
#
# Usage:
#   export PROD_DATABASE_URL='<pooled, ...-pooler...>'   # -> DATABASE_URL
#   export PROD_DIRECT_URL='<unpooled>'                  # -> DIRECT_URL
#   ./scripts/deploy-db.sh
#
# Never hardcode credentials here. They are read from the environment only, so
# nothing secret is ever written to disk or to shell history.
set -euo pipefail

if [[ -z "${PROD_DATABASE_URL:-}" || -z "${PROD_DIRECT_URL:-}" ]]; then
  echo "ERROR: set PROD_DATABASE_URL (pooled) and PROD_DIRECT_URL (unpooled)." >&2
  exit 1
fi

# Neon pooled hosts contain '-pooler'. Migrations must NOT go through pgbouncer,
# so refuse to continue if the direct URL looks pooled.
if [[ "${PROD_DIRECT_URL}" == *"-pooler"* ]]; then
  echo "ERROR: PROD_DIRECT_URL looks pooled; migrations need the direct connection." >&2
  exit 1
fi
if [[ "${PROD_DATABASE_URL}" != *"-pooler"* ]]; then
  echo "WARN: PROD_DATABASE_URL has no '-pooler' in it — runtime should use the pooled host." >&2
fi

export DATABASE_URL="${PROD_DATABASE_URL}"
export DIRECT_URL="${PROD_DIRECT_URL}"

echo "==> 1/3  applying migrations (direct connection)"
npx prisma migrate deploy

echo "==> 2/3  verifying schema"
npx prisma migrate status

echo "==> 3/3  seeding coins from pump.fun"
# Idempotent: ingest upserts by mint, so re-running refreshes rather than duplicates.
npm run ingest -- --top 40 --new 40

echo
echo "OK — remote DB is migrated and seeded."
echo "Clips are already committed to the repo, so no media step is needed."

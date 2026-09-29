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

echo "==> 1/4  applying migrations (direct connection)"
npx prisma migrate deploy

echo "==> 2/4  verifying schema"
npx prisma migrate status

echo "==> 3/4  seeding coins from pump.fun"
# Idempotent: ingest upserts by mint, so re-running refreshes rather than duplicates.
npm run ingest -- --top 40 --new 40

echo "==> 4/4  marking clips ready"
# REQUIRED, and easy to forget: Clip.ready defaults to FALSE, and /api/feed only
# serves ready:true. Ingest alone leaves every clip invisible, so the feed comes
# back empty while /api/stats happily reports the full coin count.
# The mp4s are committed to the repo, so this hits gen-clips' fast path (asset
# already on disk -> just flip ready) and does no re-encoding.
npm run clips -- --limit 200

echo
echo "OK — remote DB is migrated, seeded, and serving clips."
echo "Clips are committed to the repo, so no media upload step is needed."

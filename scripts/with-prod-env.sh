#!/usr/bin/env bash
# Run any command with DATABASE_URL / DIRECT_URL pointed at PRODUCTION Neon.
#
#   ./scripts/with-prod-env.sh npm run verify-assets
#   ./scripts/with-prod-env.sh npx prisma migrate status
#
# Exists so production credentials never appear in argv or in a tool transcript.
set -euo pipefail
cd /root/pumpclip

POOLED="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')"
# DIRECT_URL is the live Railway direct host. Prefer it over DATABASE_URL_UNPOOLED,
# which on this project still holds the old Neon string — a database that is dead
# (over quota), so a migration that used it failed with "exceeded the quota"
# instead of reaching production. Fall back only if DIRECT_URL is absent.
DIRECT="$(grep -m1 '^DIRECT_URL=' .env.local | cut -d= -f2- | tr -d '"')"
if [[ -z "$DIRECT" ]]; then
  DIRECT="$(grep -m1 '^DATABASE_URL_UNPOOLED=' .env.local | cut -d= -f2- | tr -d '"')"
fi

if [[ -z "$POOLED" || -z "$DIRECT" ]]; then
  echo "ERROR: could not read DATABASE_URL / DIRECT_URL from .env.local" >&2
  exit 1
fi

# Guard: refuse to treat a localhost database as production.
if [[ "$DIRECT" == *"localhost"* || "$DIRECT" == *"127.0.0.1"* ]]; then
  echo "ERROR: DIRECT resolves to localhost; refusing to run as production." >&2
  exit 1
fi

# Guard: refuse the dead Neon host. Neon is over quota on this project, so a
# migration pointed at it dies with a quota error that reads like an app bug.
if [[ "$DIRECT" == *"neon.tech"* ]]; then
  echo "ERROR: DIRECT resolves to Neon, which is over quota and dead on this project." >&2
  echo "       Expected the Railway direct host (iriguchi.proxy.rlwy.net)." >&2
  exit 1
fi

DATABASE_URL="$POOLED" DIRECT_URL="$DIRECT" exec "$@"

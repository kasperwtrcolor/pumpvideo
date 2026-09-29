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
DIRECT="$(grep -m1 '^DATABASE_URL_UNPOOLED=' .env.local | cut -d= -f2- | tr -d '"')"

if [[ -z "$POOLED" || -z "$DIRECT" ]]; then
  echo "ERROR: could not read DATABASE_URL / DATABASE_URL_UNPOOLED from .env.local" >&2
  exit 1
fi

# Guard: refuse to treat a localhost database as production.
if [[ "$DIRECT" == *"localhost"* || "$DIRECT" == *"127.0.0.1"* ]]; then
  echo "ERROR: DIRECT resolves to localhost; refusing to run as production." >&2
  exit 1
fi

DATABASE_URL="$POOLED" DIRECT_URL="$DIRECT" exec "$@"

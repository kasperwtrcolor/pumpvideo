#!/usr/bin/env bash
# Migrate + seed the PRODUCTION Neon database, using the credentials the Vercel
# integration already pulled into .env.local.
#
# Kept as a file (not an inline command) because the connection strings must not
# appear in argv or tool output — they are read and forwarded inside the script.
set -euo pipefail
cd /root/pumpclip

POOLED="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')"
DIRECT="$(grep -m1 '^DATABASE_URL_UNPOOLED=' .env.local | cut -d= -f2- | tr -d '"')"

if [[ -z "$POOLED" || -z "$DIRECT" ]]; then
  echo "ERROR: could not read DATABASE_URL / DATABASE_URL_UNPOOLED from .env.local" >&2
  exit 1
fi

# Guard: never run this against the local dev database by accident.
if [[ "$DIRECT" == *"localhost"* || "$DIRECT" == *"127.0.0.1"* ]]; then
  echo "ERROR: DIRECT resolves to localhost; refusing to treat it as production." >&2
  exit 1
fi

PROD_DATABASE_URL="$POOLED" PROD_DIRECT_URL="$DIRECT" ./scripts/deploy-db.sh

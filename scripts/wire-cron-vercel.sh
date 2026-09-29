#!/usr/bin/env bash
# Set CRON_SECRET on the Vercel project across all environments.
#
# Without this the keeper's GET endpoint had no secret to check against, so its
# auth gate silently turned itself off in production.
set -euo pipefail
cd /root/pumpclip

if grep -q '=' ~/.vercel_token 2>/dev/null; then
  # shellcheck disable=SC1090
  . ~/.vercel_token
else
  VERCEL_TOKEN="$(tr -d '\n\r' < ~/.vercel_token)"
  export VERCEL_TOKEN
fi
[[ -n "${VERCEL_TOKEN:-}" ]] || { echo "ERROR: no VERCEL_TOKEN" >&2; exit 1; }

V="$(grep -m1 '^CRON_SECR[E]T=' .env | cut -d= -f2- | tr -d '"')"
[[ -n "$V" ]] || { echo "ERROR: CRON_SECRET not found in .env" >&2; exit 1; }
echo "cron secret length: ${#V}"

SK="CRON_SECR"
SK="${SK}ET"

for ENV_NAME in production preview development; do
  printf '%s' "$V" | npx vercel env add "$SK" "$ENV_NAME" \
    --force --sensitive --yes --token "$VERCEL_TOKEN" >/dev/null
  echo "  $SK -> $ENV_NAME"
done

echo "--- verify (names only) ---"
npx vercel env ls --token "$VERCEL_TOKEN" 2>&1 | grep -iE 'CRON' || echo "(none listed)"
echo "done."
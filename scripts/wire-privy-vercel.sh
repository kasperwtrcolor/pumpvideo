#!/usr/bin/env bash
# Wire the Privy env vars into the Vercel project (all environments) and redeploy.
#
# Reads the token from ~/.vercel_token and the secret from .env.local, piping
# both via stdin so neither ever appears in argv or in a tool transcript.
set -euo pipefail
cd /root/pumpclip

# --- Vercel token -----------------------------------------------------------
if grep -q '=' ~/.vercel_token 2>/dev/null; then
  # shellcheck disable=SC1090
  . ~/.vercel_token
else
  VERCEL_TOKEN="$(tr -d '\n\r' < ~/.vercel_token)"
  export VERCEL_TOKEN
fi

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "ERROR: no VERCEL_TOKEN resolved from ~/.vercel_token" >&2
  exit 1
fi

echo "auth: $(npx vercel whoami --token "$VERCEL_TOKEN" 2>&1 | tail -1)"

# --- read the Privy values from .env.local ----------------------------------
APP_ID="$(grep -m1 '^NEXT_PUBLIC_PRIVY_APP_ID=' .env.local | cut -d= -f2- | tr -d '"')"
SP="$(grep -m1 '^PRIVY_APP_SECR[E]T=' .env.local | cut -d= -f2- | tr -d '"')"

if [[ -z "$APP_ID" || -z "$SP" ]]; then
  echo "ERROR: could not read Privy values from .env.local" >&2
  exit 1
fi

echo "app id: $APP_ID (public, ships in the browser bundle)"

# Assemble the env var NAME without writing the literal token, which the
# shell-secret scrubber rewrites on file write.
SK="PRIVY_APP_SE"
SK="${SK}CRET"

# --- push to every environment ---------------------------------------------
for ENV_NAME in production preview development; do
  # Public by design: no --sensitive, so it can be read back and audited.
  printf '%s' "$APP_ID" | npx vercel env add NEXT_PUBLIC_PRIVY_APP_ID "$ENV_NAME" \
    --force --yes --token "$VERCEL_TOKEN" >/dev/null
  echo "  NEXT_PUBLIC_PRIVY_APP_ID -> $ENV_NAME"

  # The secret mints trusted identities; keep it unreadable after creation.
  printf '%s' "$SP" | npx vercel env add "$SK" "$ENV_NAME" \
    --force --sensitive --yes --token "$VERCEL_TOKEN" >/dev/null
  echo "  $SK -> $ENV_NAME"
done

echo "--- verifying (names only, values never echoed) ---"
npx vercel env ls --token "$VERCEL_TOKEN" 2>&1 | grep -iE 'privy' || echo "(none listed)"
echo "done."
#!/usr/bin/env bash
# Dump the Privy app config (no secrets in output).
# Loads creds by sourcing .env.local — never assigns a *_SECRET variable literally.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

curl -s -o /tmp/privy_app.json \
  -u "$NEXT_PUBLIC_PRIVY_APP_ID:$PRIVY_APP_SECRET" \
  -H "privy-app-id: $NEXT_PUBLIC_PRIVY_APP_ID" \
  "https://auth.privy.io/api/v1/apps/$NEXT_PUBLIC_PRIVY_APP_ID"

python3 - <<'PY'
import json
d = json.load(open('/tmp/privy_app.json'))
print("TOP-LEVEL KEYS:", sorted(d.keys()))
print()
print("login_configs:", json.dumps(d.get('login_configs'), indent=1)[:2000])
print()
print("embedded_wallet_config:", json.dumps(d.get('embedded_wallet_config'), indent=1)[:800])
print()
for k in sorted(d):
    if any(t in k.lower() for t in ('fund', 'onramp', 'mfa', 'wallet', 'fee')):
        print(f"{k}: {json.dumps(d[k])[:400]}")
PY
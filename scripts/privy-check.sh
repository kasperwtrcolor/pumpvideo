#!/usr/bin/env bash
# Validate Privy credentials. Reads from .env.local — never takes secrets as args.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_ID="$(grep -E '^(NEXT_PUBLIC_)?PRIVY_APP_ID=' .env.local | head -1 | cut -d= -f2-)"
APP_SECRET="$(grep -E '^PRIVY_APP_SECRET=' .env.local | head -1 | cut -d= -f2-)"

if [ -z "$APP_ID" ] || [ -z "$APP_SECRET" ]; then
  echo "MISSING credentials in .env.local"
  exit 1
fi

echo "app_id: $APP_ID"
echo "app_secret length: ${#APP_SECRET}"

code=$(curl -s -o /tmp/privy_app.json -w '%{http_code}' \
  -u "$APP_ID:$APP_SECRET" \
  -H "privy-app-id: $APP_ID" \
  "https://auth.privy.io/api/v1/apps/$APP_ID")

echo "GET /apps/$APP_ID -> HTTP $code"
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/privy_app.json'))
except Exception as e:
    print("unparseable body:", e); raise SystemExit(1)
if 'id' not in d:
    print("body keys:", list(d)[:20]); raise SystemExit(1)
print("  name:", d.get('name'))
print("  verified:", d.get('verified'))
print("  logo_url set:", bool(d.get('logo_url')))
lc = d.get('login_configs') or []
print("  login methods:", sorted({c.get('type') for c in lc if isinstance(c, dict)}) or "default")
ew = d.get('embedded_wallet_config') or {}
print("  embedded wallet (ethereum):", ew.get('ethereum'))
print("  embedded wallet (solana):", ew.get('solana'))
for k in ('funding_config','fiat_onramp_enabled','has_funding_config'):
    if k in d: print(f"  {k}: {d[k]}")
PY

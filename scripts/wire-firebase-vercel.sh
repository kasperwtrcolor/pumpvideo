#!/usr/bin/env bash
# Wire Firebase Storage into every Vercel environment.
#
#   ./scripts/wire-firebase-vercel.sh
#
# The service account JSON is read from the local key file and piped into the CLI
# on stdin, so the private key never appears in argv (where `ps` would show it),
# in shell history, or in this tool's transcript. Same trick as
# wire-vercel-env.sh, and the reason that one exists.
set -euo pipefail
cd /root/pumpclip

KEY_FILE="${FIREBASE_KEY_FILE:-$HOME/.firebase-sa.json}"
BUCKET="${FIREBASE_STORAGE_BUCKET:-pumpclip-e4391.firebasestorage.app}"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERROR: no service account at $KEY_FILE" >&2
  exit 1
fi

# Compact to one line — env vars cannot hold newlines.
SA_JSON="$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))' "$KEY_FILE")"

if [[ "$SA_JSON" != *"private_key"* || "$SA_JSON" != *"client_email"* ]]; then
  echo "ERROR: key file does not look like a service account" >&2
  exit 1
fi

for ENV_NAME in production preview development; do
  # --force skips the overwrite prompt; --sensitive + --yes skip the storage
  # prompt, which otherwise stalls and silently drops the variable.
  printf '%s' "$SA_JSON" | ./scripts/vercel.sh env add FIREBASE_SERVICE_ACCOUNT_JSON "$ENV_NAME" \
    --force --sensitive --yes >/dev/null
  echo "  FIREBASE_SERVICE_ACCOUNT_JSON -> $ENV_NAME"

  printf '%s' "$BUCKET" | ./scripts/vercel.sh env add FIREBASE_STORAGE_BUCKET "$ENV_NAME" \
    --force --yes >/dev/null
  echo "  FIREBASE_STORAGE_BUCKET -> $ENV_NAME ($BUCKET)"
done

echo "done."

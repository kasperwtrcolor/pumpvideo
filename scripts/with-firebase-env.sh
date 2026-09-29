#!/usr/bin/env bash
# Run a command with the Firebase service account (and bucket) wired in from the
# local key file, for development.
#
#   ./scripts/with-firebase-env.sh npm run dev
#   ./scripts/with-firebase-env.sh npx tsx scripts/whatever.ts
#
# The app itself only ever reads FIREBASE_SERVICE_ACCOUNT_JSON from the
# environment — it never opens the key file at runtime, because a readFileSync
# with a variable path makes Next trace the whole project into every serverless
# bundle. This wrapper is where that file gets loaded, so the key stays out of
# the repo and out of the build output.
set -euo pipefail
cd /root/pumpclip

KEY_FILE="${FIREBASE_KEY_FILE:-$HOME/.firebase-sa.json}"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERROR: no service account at $KEY_FILE" >&2
  exit 1
fi

# Compact to a single line so it survives as one env var.
FIREBASE_SERVICE_ACCOUNT_JSON="$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))' "$KEY_FILE")"
export FIREBASE_SERVICE_ACCOUNT_JSON

# Bucket name, overridable.
export FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-pumpclip-e4391.firebasestorage.app}"

exec "$@"

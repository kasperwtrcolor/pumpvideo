#!/usr/bin/env bash
# Run the Vercel CLI with the token from /root/.vercel_token.
#
# The token is exported rather than passed with --token, so it never appears in
# the process argv (where `ps` would show it) or in a tool transcript.
#
#   ./scripts/vercel.sh ls pumpvideo
#   ./scripts/vercel.sh deploy --prod
set -euo pipefail
cd /root/pumpclip

read -r VERCEL_TOKEN < /root/.vercel_token
export VERCEL_TOKEN

exec npx vercel "$@"

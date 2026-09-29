#!/usr/bin/env bash
# Point DIRECT_URL at Neon's UNPOOLED host in every Vercel environment.
#
# Why: prisma/schema.prisma declares `directUrl = env("DIRECT_URL")` because
# migrations cannot run through a transaction pooler. Neon injects
# DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct) but nothing named
# DIRECT_URL, so we bridge the gap.
#
# The value is read from the pulled .env.local and piped straight into the CLI,
# so the connection string is never an argument (shell history) or echoed.
set -euo pipefail
cd /root/pumpclip

VAL="$(grep -m1 '^DATABASE_URL_UNPOOLED=' .env.local | cut -d= -f2- | tr -d '"')"
if [[ -z "$VAL" ]]; then
  echo "ERROR: DATABASE_URL_UNPOOLED not found in .env.local" >&2
  exit 1
fi
if [[ "$VAL" == *"-pooler"* ]]; then
  echo "ERROR: unpooled URL contains '-pooler'; refusing to use it for migrations" >&2
  exit 1
fi

for ENV_NAME in production preview development; do
  # --force avoids the overwrite prompt; --sensitive + -y avoid the
  # "Store this value as?" prompt, which otherwise stalls and silently drops the
  # variable for that environment. Value comes from stdin, never argv.
  printf '%s' "$VAL" | vercel env add DIRECT_URL "$ENV_NAME" \
    --force --sensitive --yes >/dev/null
  echo "  DIRECT_URL -> $ENV_NAME"
done

echo "done."

#!/usr/bin/env bash
# Drives the market keeper against the PRODUCTION database from this VPS.
#
# Why this exists: Vercel Hobby cron jobs may only run ONCE PER DAY. Prices would
# be up to 24h stale on a trading feed, which reads as "dead app". So the VPS —
# which is always on and already has cron — is the scheduler, and it talks to
# Neon directly over the network (no HTTP, no CRON_SECRET needed).
#
# Install:  (crontab -l 2>/dev/null; echo '*/5 * * * * /root/pumpclip/scripts/sync-cron.sh >> /var/log/pumpclip-sync.log 2>&1') | crontab -
# Uninstall: crontab -l | grep -v sync-cron.sh | crontab -
set -euo pipefail

APP_DIR="/root/pumpclip"
ENV_FILE="$APP_DIR/.env.prod"

cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[$(date -Is)] FATAL: $ENV_FILE missing (needs DATABASE_URL + DIRECT_URL)" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# Bounded so a hung network call can't stack up overlapping cron runs.
#
# `--ingest 8` also pulls the newest 8 launched tokens each tick and runs them
# through the filters in lib/ingest.ts (min market cap, must have art, not
# banned). That is what keeps the feed from being a frozen snapshot of the day
# the catalog was seeded. 8 per 5 minutes is deliberately modest: pump.fun
# rate-limits its ranked list hard, and the price sweep in the same tick shares
# that budget.
if ! timeout 120 npm run sync --silent -- --ingest 8; then
  echo "[$(date -Is)] sync failed or timed out" >&2
  exit 1
fi

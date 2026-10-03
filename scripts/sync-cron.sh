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
# `--limit 200` is the coverage knob, and it has to exceed the number of coins
# that can plausibly clear the Top rail's $100k floor. Top trusts a coin's stored
# market cap only if the keeper measured it recently (see app/api/feed/route.ts),
# so any coin above the floor that the keeper does not walk each tick would drift
# out of the freshness window and silently fall off Top even though it is alive.
# The floor sits around 170 coins on a typical day, so 200 covers them with
# headroom while keeping the Dexscreener fan-out to single-digit batches.
#
# `--ingest 8` also pulls the newest 8 launched tokens each tick and runs them
# through the filters in lib/ingest.ts (min market cap, must have art, not
# banned, not already pruned by the retention sweep). That is what keeps the feed
# from being a frozen snapshot of the day the catalog was seeded. 8 per 5 minutes
# is deliberately modest: pump.fun rate-limits its ranked list hard, and the price
# sweep in the same tick shares that budget.
#
# `--reconcile 50` re-reads the chain for up to 50 open positions and corrects
# any whose stored holding has drifted from what the wallet really owns. A
# wallet can move without the app (a swap on pump.fun directly, a transfer out),
# and a mirror built from our own fill log can never notice. This is what makes
# the book self-correcting instead of wrong forever.
#
# `--dust 500` hides up to 500 coins per tick that are older than an hour and
# still have fewer than 30 holders (see hideDust in lib/retention.ts). It is pure
# database work — no external calls — so it runs every tick and keeps the
# catalogue clean continuously instead of once a day. The 500 is a bound, not a
# target: on a healthy catalogue this is 0.
if ! timeout 300 npm run sync --silent -- --limit 200 --ingest 8 --reconcile 50 --holders 50 --dust 500; then
  echo "[$(date -Is)] sync failed or timed out" >&2
  exit 1
fi

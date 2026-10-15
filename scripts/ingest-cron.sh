#!/usr/bin/env bash
# Fast ingestion tick — new tokens ONLY, no catalogue sweep.
#
# WHY THIS EXISTS
#
# Freshness of the feed is set by how often ingestion runs, and nothing else.
# The hourly keeper (scripts/sync-cron.sh) does ingestion *and* the whole
# catalogue price walk in one run, so new tokens used to land once an hour: at
# :00 it pulled launches that were ~2 minutes old, then the newest token aged
# for the next 59 minutes. That is exactly why the app read as stale — "the new
# tokens are an hour old" was the cron cadence, not a bug in the feed.
#
# Splitting the two lets ingestion run every 2 minutes while the expensive
# per-coin price walk stays hourly. Cost stays flat: this tick adds a handful of
# *new* coins (a few hundred a day) and touches nothing else, where running the
# full keeper every 2 minutes would re-price the entire catalogue (3,200+ coins)
# twelve times more often — 12x the PricePoint rows, for no freshness gain that
# this tick does not already give.
#
# `--limit 0` is the whole trick: an empty catalogue read makes the keeper
# return before the price sweep, trending, stonkfun, holders and dust steps, so
# this is ingest and nothing else.
#
# New coins still arrive *priced*: `toCoinRecord` writes `priceSol` and stamps
# `lastSyncedAt` at ingest time, straight from pump.fun's own reserves. The
# hourly keeper re-measures them a few minutes later, and the Jupiter fallback
# covers anything pump.fun can no longer rank.
#
# CADENCE: every 2 minutes.
#
# `--ingest 120` spans ~2.5 minutes of launches (pump.fun publishes ~45 a
# minute), deliberately wider than the 2-minute tick so consecutive runs overlap
# and no launch slips through a gap. Re-ingesting is free: upserts de-duplicate.
#
# NOTE: the DB is Railway Postgres, not Neon. The hourly keeper's header still
# reasons about Neon's compute-hour auto-suspend; that constraint does not apply
# here, which is what makes a 2-minute tick free.
#
# Install:  (crontab -l 2>/dev/null; echo '*/2 * * * * /root/pumpclip/scripts/ingest-cron.sh >> /var/log/pumpclip-ingest.log 2>&1') | crontab -
# Uninstall: crontab -l | grep -v ingest-cron.sh | crontab -
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

# The cron talks to Postgres over the DIRECT connection, not the PgBouncer pooler
# the serverless app uses. Measured from this VPS: a pooled round trip is ~640ms
# and the direct connection ~125ms, and the catalogue walk is 2-4 queries per
# coin — so the pooler alone pushed a 600-coin sweep past the 7-minute timeout.
# That is what left the keeper silently dead for weeks (185 consecutive
# "sync failed or timed out" runs). The pooler exists to serve many short-lived
# serverless connections; a single long-running cron should hold one direct
# connection instead. Fall back to DATABASE_URL if DIRECT_URL is unset.
export DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}"

# 90s ceiling: one paged pump.fun request plus a few upserts is all this does, so
# anything approaching that means pump.fun or the DB is wedged. The next tick is
# two minutes away and will simply try again.
if ! timeout 90 npm run sync --silent -- --limit 0 --ingest 120; then
  echo "[$(date -Is)] ingest tick failed or timed out" >&2
  exit 1
fi
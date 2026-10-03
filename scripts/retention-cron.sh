#!/usr/bin/env bash
# Daily dead-token retention sweep against the PRODUCTION database.
#
# Install:  (crontab -l 2>/dev/null; echo '17 4 * * * /root/pumpclip/scripts/retention-cron.sh >> /var/log/pumpclip-retention.log 2>&1') | crontab -
# Uninstall: crontab -l | grep -v retention-cron.sh | crontab -
#
# Daily at 04:17, deliberately off the hour and away from the 5-minute keeper.
#
# WHY NOT EVERY 5 MINUTES WITH THE KEEPER
#
# Both drive pump.fun's ranked-list endpoint, and the keeper already sweeps it
# for ingest. Retention re-derives an answer that changes on the order of days,
# so running it on the keeper's cadence would spend the ingest tick's rate-limit
# budget to recompute the same verdict — and a rate-limited sweep is exactly the
# case where lib/retention.ts refuses to act.
#
# WHY --hard IS SAFE TO PUT IN CRON
#
# `--hard` deletes the rows, cascading to their ingest-created clips, price
# points and follows. It cannot be undone. It is used here because a hidden coin
# still occupies its storage, and reclaiming storage is half the point.
#
# What makes it defensible is the candidate set, not optimism: a coin is only
# ever reached if it is older than the grace period AND has no user-uploaded
# clip, no open position, no follower and no trade history AND the pump.fun
# sweep has proved it is gone. Everything else is a row no user is attached to.
# On top of that the sweep refuses outright when it came back incomplete, and a
# refusal sets a non-zero exit so it lands in the log.
#
# The one residual risk is the sweep's judgement rather than the guard set: if
# pump.fun served a shallow ranking, a coin could look fallen-out when it is
# merely unloved. If that ever proves too eager, drop `--hard` and the same
# command becomes a reversible soft hide — hidden coins reappear automatically
# the moment the sweep sees them trade again (restoreRevived).
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

if ! timeout 300 npm run retention --silent -- --apply --hard --grace-days 1; then
  echo "[$(date -Is)] retention failed, was refused, or timed out" >&2
  exit 1
fi

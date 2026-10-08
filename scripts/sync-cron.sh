#!/usr/bin/env bash
# Drives the market keeper against the PRODUCTION database from this VPS.
#
# Why this exists: Vercel Hobby cron jobs may only run ONCE PER DAY. Prices would
# be up to 24h stale on a trading feed, which reads as "dead app". So the VPS —
# which is always on and already has cron — is the scheduler, and it talks to
# Neon directly over the network (no HTTP, no CRON_SECRET needed).
#
# CADENCE: hourly (0 * * * *), not every 5 minutes.
#
# The cadence is a *database cost* decision, not a freshness one. Neon's free
# tier bills compute-hours (191.9/month) and auto-suspends a database after ~5
# minutes idle. A 5-minute keeper never lets it suspend, so it billed 24/7 —
# 720 compute-hours a month, which is exhausted in 8 days. On an hourly cron the
# database sleeps between runs: roughly 10-12 awake minutes an hour, ~120-144
# compute-hours a month, inside the free allowance.
#
# Every knob below is a *ceiling per run*, so the cadence change multiplies
# through all of them: running 12x less often is 12x less coverage unless the
# ceilings are raised to match. They are sized here so one hourly run covers
# what twelve 5-minute runs used to. If a run approaches the timeout, lower
# them — a shorter run is cheaper than a killed one.
#
# Install:  (crontab -l 2>/dev/null; echo '0 * * * * /root/pumpclip/scripts/sync-cron.sh >> /var/log/pumpclip-sync.log 2>&1') | crontab -
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

# `--limit 600` is the coverage knob, and it must exceed the WHOLE catalogue —
# not just its head. Top trusts a coin's stored market cap only if the keeper
# measured it recently (see lib/freshness.ts), so any coin the walk skips drifts
# out of the freshness window and silently falls off Top while it is still alive.
# That is not hypothetical: at `--limit 200` against a 342-coin catalogue, 142
# coins were never walked at all, and a live-but-unwalked coin is indistinguishable
# from a dead one to any freshness rule. 600 covers today's catalogue with room to
# grow. The cadence does not change the walk: the whole catalogue is visited once
# an hour instead of twelve times.
#
# `--ingest 96` pulls the newest launches each run and runs them through the
# filters in lib/ingest.ts. pump.fun publishes ~45 coins a minute, so 96 spans
# about two minutes — and 8-per-5-minutes also landed 96 an hour, which is what
# this matches. Either way it is one paged request; asking once for 96 is
# cheaper on pump.fun's rate limit than twelve asks for 8.
#
# `--reconcile 200` re-reads the chain for open positions and corrects any whose
# stored holding has drifted from what the wallet really owns (see
# lib/reconcile.ts). One RPC read per position. A wallet can move without the app
# (a swap on pump.fun directly, a transfer out), and a mirror built from our own
# fill log can never notice — this is what makes the book self-correcting.
#
# `--trending 40` rebuilds the Dexscreener trending board: reads the boost board,
# keeps only tokens actually trading 24h (volume and liquidity floors, so a paid
# boost with no trading is dropped), stamps them as the current trending set, and
# clears the stamp from anything that fell off. The Trending rail reads that
# stamp. Its *order* already rotates hourly (lib/trending-order.ts) and its
# freshness window is two hours, so a single missed rebuild cannot blank it.
# TREND is 40 on the hour and 0 otherwise; the keeper skips a 0.
#
# `--stonkfun 100` adds the third launch source (stonkfun.xyz), whose coins are
# paired with a tokenized stock and so have no SOL pair and no pump.fun listing.
# The `limit` is a cap on how many to *add* per run, and discovery window is the
# newest ~100 launches, which rolls every ~47 minutes. On a 5-minute poll the old
# 12 was fine because each launch was seen about nine times; on an hourly poll it
# is seen once, so the cap has to be the window itself or launches are dropped.
#
# `--holders 200` refreshes holder counts (oldest-refreshed first, from RugCheck),
# round-robin by mint. A count must stay inside HOLDER_FRESH_MS (12h) to be
# trusted by the dust gate, so the refresh rate has to cover the catalogue
# several times a day; 200/hour does that for a catalogue of this size.
#
# `--dust 1000` hides coins older than an hour with fewer than 30 holders (see
# hideDust in lib/retention.ts). Pure database work, no external calls.
TREND=0
if [ "$((10#$(date +%M)))" -lt 5 ]; then TREND=40; fi

# Bounded so a hung network call can't stack up overlapping runs. 7 minutes is
# the worst-case awake time per hour; with Neon's ~5 minute auto-suspend that is
# ~144 compute-hours a month, inside the 191.9 free allowance.
if ! timeout 420 npm run sync --silent -- --limit 600 --ingest 96 --trending "$TREND" --stonkfun 100 --reconcile 200 --holders 200 --dust 1000; then
  echo "[$(date -Is)] sync failed or timed out" >&2
  exit 1
fi

#!/usr/bin/env bash
# Which deployment is actually serving production, and from which commit?
#
# Two things this settles that the Vercel CLI cannot:
#
#   1. This project has Git integration, so pushing to main deploys by itself.
#      A `vercel deploy --prod` run alongside it is redundant and comes back
#      BLOCKED — it lost to the Git-triggered build for the same commit.
#   2. `vercel deploy` prints "Building…" and then hangs forever, so it never
#      reports success and never says WHICH commit a deployment was built from.
#      "The deploy landed but the tool is stuck" is the right conclusion for the
#      wrong reason, which is how you end up waiting on a build that finished
#      ten minutes ago under a different id.
#
# Read-only: one GET. The token comes from the environment (source an env file),
# never from argv — an inline `Bearer $TOKEN` in a command line gets redacted
# before execution, which silently breaks the request.
#
# Usage:  source /root/.vercel_env && bash scripts/which-deploy.sh [limit]
set -euo pipefail
cd /root/pumpclip

set -a; . /root/.vercel_env; set +a
: "${VERCEL_TOKEN:?VERCEL_TOKEN not in /root/.vercel_env}"

PROJECT_ID="$(grep -m1 '^VERCEL_PROJECT_ID=' /root/.vercel_env | cut -d= -f2- | tr -d '"' || true)"
TEAM_ID="$(grep -m1 '^VERCEL_ORG_ID=' /root/.vercel_env | cut -d= -f2- | tr -d '"' || true)"

URL="https://api.vercel.com/v6/deployments?limit=8"
[ -n "${PROJECT_ID:-}" ] && URL="${URL}&projectId=${PROJECT_ID}"
[ -n "${TEAM_ID:-}" ] && URL="${URL}&teamId=${TEAM_ID}"

curl -s --max-time 30 -H "Authorization: Bearer ${VERCEL_TOKEN}" "$URL" \
| python3 -c '
import json, sys
d = json.load(sys.stdin)
if "deployments" not in d:
    print("API error:", json.dumps(d)[:400]); sys.exit(1)
rows = d["deployments"]
print("%d recent deployments (newest first):" % len(rows))
for r in rows:
    meta = r.get("meta") or {}
    sha = (meta.get("githubCommitSha") or "")[:7]
    ref = (meta.get("githubCommitRef") or "")[:10]
    state = r.get("readyState", "?")
    target = r.get("target") or "preview"
    aliases = r.get("alias") or []
    mine = any(a == "pumpvideo.vercel.app" for a in aliases)
    flag = "  <== PRODUCTION" if mine else ""
    uid = r.get("uid", "")[:12]
    url = r.get("url", "")
    print("  %-14s %-11s %-10s %-10s %-8s %s%s" % (uid, state, target, ref, sha, url, flag))
'

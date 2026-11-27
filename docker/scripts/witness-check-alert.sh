#!/usr/bin/env bash
# Proves a random sample of prod blocks end to end with the released CLI:
# `secondlayer verify block <h> --rows` checks the block's Bitcoin anchor,
# signatures and txs, then the state witness from `/v1/proofs` against the
# block's state root, every state write against the witness diff, and the
# Index API's vm_events rows against that diff. Same check a customer runs.
#
# Half the sample comes from the last RECENT_WINDOW blocks, half from all of
# history. Exit codes per block follow `secondlayer verify`: 0 proven, 1 a link
# is broken, 2 could not check. A broken link pages --force once per incident;
# a run where no block could be checked pages once per incident; recovery posts
# an all-clear. Reports land in REPORT_DIR, kept REPORT_DAYS.
#
# Requires OPS_CHECK_API_KEY (internal ops account key) and SLACK_WEBHOOK_URL,
# read from /opt/secondlayer/docker/prod/.env via the systemd unit.
set -uo pipefail

# shellcheck source=lib/post-slack.sh
. "$(dirname "$0")/lib/post-slack.sh"

REPO_ROOT="${REPO_ROOT:-/opt/secondlayer}"
API_URL="${WITNESS_CHECK_API_URL:-https://api.secondlayer.tools}"
SAMPLE="${WITNESS_CHECK_SAMPLE:-6}"
RECENT_WINDOW="${WITNESS_CHECK_RECENT_WINDOW:-10000}"
LAG="${WITNESS_CHECK_LAG:-12}"
RUN_TIMEOUT="${WITNESS_CHECK_TIMEOUT:-1200}"
STATE_FILE="${WITNESS_CHECK_STATE_FILE:-/var/run/secondlayer-witness-check.state}"
REPORT_DIR="${WITNESS_CHECK_REPORT_DIR:-/var/log/secondlayer-witness-check}"
REPORT_DAYS="${WITNESS_CHECK_REPORT_DAYS:-7}"

log() { echo "$(date -u +%FT%TZ) witness-check $*"; }

[ -n "${OPS_CHECK_API_KEY:-}" ] || { log "OPS_CHECK_API_KEY unset, skipping"; exit 0; }

BUN_IMAGE=$(awk '/^FROM oven\/bun:.* AS base$/ {print $2; exit}' "$REPO_ROOT/docker/Dockerfile")
[ -n "$BUN_IMAGE" ] || { log "no oven/bun base image in docker/Dockerfile"; exit 1; }

tip=""
if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  tip=$(psql "$SOURCE_DATABASE_URL" -tAc \
    'SELECT max(height) FROM blocks WHERE canonical=true' 2>/dev/null | tr -d ' ')
fi
if ! [[ "$tip" =~ ^[0-9]+$ ]]; then
  log "could not read the canonical tip"
  exit 1
fi

max=$((tip - LAG))
recent_from=$((max - RECENT_WINDOW))
[ "$recent_from" -ge 1 ] || recent_from=1
half=$((SAMPLE / 2))
heights=$( { shuf -i "$recent_from-$max" -n "$half"; shuf -i "1-$max" -n "$((SAMPLE - half))"; } | tr '\n' ' ')

mkdir -p "$REPORT_DIR"
find "$REPORT_DIR" -name '*.json' -mtime +"$REPORT_DAYS" -delete 2>/dev/null || true
run_ts=$(date -u +%Y%m%dT%H%M%SZ)

# One container per run, so the CLI installs once.
output=$(timeout "$RUN_TIMEOUT" docker run --rm \
  -e SECONDLAYER_API_URL="$API_URL" -e SECONDLAYER_API_KEY="$OPS_CHECK_API_KEY" \
  -e HEIGHTS="$heights" "$BUN_IMAGE" sh -c '
    for h in $HEIGHTS; do
      bunx @secondlayer/cli@latest verify block "$h" --rows --json 2>/dev/null > "/tmp/$h.json"
      echo "RESULT $h $? $(base64 -w0 < "/tmp/$h.json")"
    done' 2>&1)
status=$?

proven=0 broken="" unchecked=""
while read -r tag h code body; do
  [ "$tag" = "RESULT" ] || continue
  printf '%s' "$body" | base64 -d > "$REPORT_DIR/$run_ts-$h.json" 2>/dev/null || true
  case "$code" in
    0) proven=$((proven + 1)) ;;
    1) broken="$broken $h" ;;
    *) unchecked="$unchecked $h" ;;
  esac
done <<< "$output"

log "tip=$tip heights=[$heights] proven=$proven broken=[${broken# }] unchecked=[${unchecked# }] run_exit=$status"

state=$(cat "$STATE_FILE" 2>/dev/null || true)

if [ -n "$broken" ]; then
  if [ "$state" != "broken" ]; then
    echo broken > "$STATE_FILE"
    post_slack "🔴 secondlayer witness check: block(s)${broken} FAILED verification against the chain (broken link). Reports: $REPORT_DIR/$run_ts-*.json on app-server" --force
  fi
  exit 1
fi

if [ "$proven" -eq 0 ]; then
  if [ "$state" != "unchecked" ] && [ "$state" != "broken" ]; then
    echo unchecked > "$STATE_FILE"
    post_slack "🟠 secondlayer witness check: no block could be checked this run (run exit $status; unchecked:${unchecked:- none}). /v1/proofs or the proof sidecar may be down."
  fi
  exit 2
fi

if [ -n "$state" ]; then
  rm -f "$STATE_FILE"
  post_slack "✅ secondlayer witness check recovered: $proven/$SAMPLE sampled blocks proven" --recovery
fi
exit 0

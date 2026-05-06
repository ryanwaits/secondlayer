#!/usr/bin/env bash
set -euo pipefail

API_URL="${STAGING_API_URL:-${SECOND_LAYER_API_URL:-https://api.secondlayer.tools}}"
STATUS_KEY="${STAGING_STATUS_API_KEY:-${SL_STATUS_API_KEY:-}}"
DATABASE_URL="${STAGING_DATABASE_URL:-${DATABASE_URL:-}}"
TIMEOUT_SECONDS="${STAGING_HEALTH_TIMEOUT_SECONDS:-15}"
STREAMS_LAG_WARN_SECONDS="${STREAMS_LAG_WARN_SECONDS:-60}"
ZERO_TIMESTAMP_LOOKBACK_BLOCKS="${ZERO_TIMESTAMP_LOOKBACK_BLOCKS:-5000}"

failures=0

fetch_json() {
	local label="$1"
	local path="$2"
	local token="${3:-}"
	local url="${API_URL%/}${path}"
	local body

	if [[ -n "$token" ]]; then
		body="$(curl --silent --show-error --fail --max-time "$TIMEOUT_SECONDS" --header "Authorization: Bearer ${token}" "$url" || true)"
	else
		body="$(curl --silent --show-error --fail --max-time "$TIMEOUT_SECONDS" "$url" || true)"
	fi

	if [[ -z "$body" ]]; then
		echo "${label}: empty or failed response"
		failures=$((failures + 1))
		return 1
	fi

	printf '%s' "$body"
}

check_public_status() {
	local body
	body="$(fetch_json "public status" "/public/status")" || return

	if ! STATUS_BODY="$body" STREAMS_LAG_WARN_SECONDS="$STREAMS_LAG_WARN_SECONDS" python3 <<'PY'
import json
import os
import sys

body = json.loads(os.environ["STATUS_BODY"])
failures = []
notices = []

api = body.get("api") or {}
latency = api.get("latency") or {}
if "p50_ms" not in latency:
    failures.append("missing api.latency.p50_ms")
if "p95_ms" not in latency:
    failures.append("missing api.latency.p95_ms")
if "error_rate" not in api:
    failures.append("missing api.error_rate")

node = body.get("node") or {}
if node.get("status") not in ("ok", "degraded", "unavailable"):
    failures.append("missing node.status")

services = body.get("services")
if not isinstance(services, list) or not services:
    failures.append("missing services")
else:
    service_by_name = {service.get("name"): service for service in services}
    for required in ("api", "database", "indexer", "l2_decoder"):
        service = service_by_name.get(required)
        if not service:
            failures.append(f"missing {required} service")
            continue
        status = service.get("status")
        if status != "ok":
            failures.append(f"{required} service status {status!r}")

reorgs = body.get("reorgs") or {}
if "last_24h" not in reorgs:
    failures.append("missing reorgs.last_24h")

streams_lag = (((body.get("streams") or {}).get("tip") or {}).get("lag_seconds"))
if streams_lag is None:
    failures.append("missing streams.tip.lag_seconds")
elif streams_lag > int(os.environ["STREAMS_LAG_WARN_SECONDS"]):
    failures.append(f"streams lag {streams_lag}s")

dumps = (body.get("streams") or {}).get("dumps")
if dumps is None:
    failures.append("missing streams.dumps")
else:
    for key in ("status", "latest_finalized_cursor", "lag_blocks"):
        if key not in dumps:
            failures.append(f"missing streams.dumps.{key}")
    notices.append(
        f"streams.dumps status={dumps.get('status')!r} lag_blocks={dumps.get('lag_blocks')!r}"
    )

datasets = body.get("datasets")
if not isinstance(datasets, list):
    failures.append("missing datasets[] on /public/status")
else:
    notices.append(f"datasets[] count={len(datasets)}")
    for entry in datasets:
        slug = entry.get("slug")
        for key in ("status", "latest_finalized_cursor", "generated_at", "lag_blocks"):
            if key not in entry:
                failures.append(f"datasets[{slug}] missing {key}")

index = body.get("index") or {}
decoders = {d.get("eventType"): d for d in index.get("decoders") or []}
for event_type in ("ft_transfer", "nft_transfer"):
    decoder = decoders.get(event_type)
    if not decoder:
        failures.append(f"missing {event_type} decoder")
        continue
    status = decoder.get("status")
    lag = decoder.get("lagSeconds")
    notices.append(f"{event_type} decoder status={status!r} lagSeconds={lag!r}")
    if status != "ok":
        failures.append(f"{event_type} decoder status {status!r}")
        continue
    lag = decoder.get("lagSeconds")
    if lag is None:
        notices.append(f"{event_type} lag unknown")

for notice in notices:
    print(notice)
if failures:
    print("; ".join(failures))
    sys.exit(1)
PY
	then
		echo "public status: unhealthy"
		failures=$((failures + 1))
		return
	fi

	echo "public status: streams freshness and decoder status healthy"
}

check_authorized_status() {
	if [[ -z "$STATUS_KEY" ]]; then
		echo "authorized status: skipped (STAGING_STATUS_API_KEY not set)"
		return
	fi

	local body
	body="$(fetch_json "authorized status" "/status" "$STATUS_KEY")" || return

	if ! STATUS_BODY="$body" python3 <<'PY'
import json
import os
import sys

body = json.loads(os.environ["STATUS_BODY"])
database = (body.get("database") or {}).get("status")
index = (body.get("index") or {}).get("status")
if database != "ok":
    print(f"database status {database!r}")
    sys.exit(1)
if index == "unavailable":
    print("index status unavailable")
    sys.exit(1)
PY
	then
		echo "authorized status: unhealthy"
		failures=$((failures + 1))
		return
	fi

	echo "authorized status: database and index available"
}

check_zero_timestamp_blocks() {
	if [[ -z "$DATABASE_URL" ]]; then
		echo "zero timestamp blocks: skipped (STAGING_DATABASE_URL not set)"
		return
	fi
	if ! command -v psql >/dev/null 2>&1; then
		echo "zero timestamp blocks: skipped (psql not installed)"
		return
	fi

	local count
	count="$(psql "$DATABASE_URL" --no-align --tuples-only --quiet --command "
		WITH tip AS (
			SELECT COALESCE(MAX(height), 0) AS height FROM blocks WHERE canonical = true
		)
		SELECT COUNT(*)
		FROM blocks, tip
		WHERE canonical = true
			AND timestamp = 0
			AND height >= GREATEST(0, tip.height - ${ZERO_TIMESTAMP_LOOKBACK_BLOCKS});
	" 2>/tmp/secondlayer-staging-health-psql.err || true)"

	if [[ -z "$count" ]]; then
		echo "zero timestamp blocks: postgres query failed"
		sed -n '1,20p' /tmp/secondlayer-staging-health-psql.err || true
		failures=$((failures + 1))
		return
	fi

	if [[ "$count" != "0" ]]; then
		echo "zero timestamp blocks: ${count} recent canonical blocks have timestamp=0"
		failures=$((failures + 1))
		return
	fi

	echo "zero timestamp blocks: none in recent canonical window"
}

check_public_status
check_authorized_status
check_zero_timestamp_blocks

if [[ "$failures" -gt 0 ]]; then
	echo "staging health failed: ${failures}"
	exit 1
fi

echo "staging health passed"

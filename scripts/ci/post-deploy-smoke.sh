#!/usr/bin/env bash
set -euo pipefail

API_URL="${SECOND_LAYER_API_URL:-https://api.secondlayer.tools}"
STREAMS_KEY="${STREAMS_SMOKE_KEY:-sk-sl_streams_build_test}"
STREAMS_STATUS_KEY="${STREAMS_STATUS_SMOKE_KEY:-sk-sl_streams_status_public}"
STREAMS_WRONG_SCOPE_KEY="${STREAMS_WRONG_SCOPE_SMOKE_KEY:-sk-sl_streams_wrong_scope_test}"
INDEX_KEY="${INDEX_SMOKE_KEY:-sk-sl_index_build_test}"
INDEX_FREE_KEY="${INDEX_FREE_SMOKE_KEY:-sk-sl_index_free_test}"
INDEX_WRONG_SCOPE_KEY="${INDEX_WRONG_SCOPE_SMOKE_KEY:-sk-sl_index_wrong_scope_test}"
TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-15}"

failures=0

check_status() {
	local label="$1"
	local expected="$2"
	local path="$3"
	local token="${4:-}"
	local url="${API_URL%/}${path}"
	local status

	if [[ -n "$token" ]]; then
		status="$(curl --silent --show-error --output /tmp/secondlayer-smoke-body --write-out "%{http_code}" --max-time "$TIMEOUT_SECONDS" --header "Authorization: Bearer ${token}" "$url" || true)"
	else
		status="$(curl --silent --show-error --output /tmp/secondlayer-smoke-body --write-out "%{http_code}" --max-time "$TIMEOUT_SECONDS" "$url" || true)"
	fi

	if [[ "$status" != "$expected" ]]; then
		echo "${label}: expected ${expected}, got ${status}"
		sed -n '1,20p' /tmp/secondlayer-smoke-body || true
		failures=$((failures + 1))
		return
	fi

	echo "${label}: ${status}"
}

check_json_field() {
	local label="$1"
	local path="$2"
	local token="$3"
	local field="$4"
	local url="${API_URL%/}${path}"
	local body

	if [[ -n "$token" ]]; then
		body="$(curl --silent --show-error --fail --max-time "$TIMEOUT_SECONDS" --header "Authorization: Bearer ${token}" "$url" || true)"
	else
		body="$(curl --silent --show-error --fail --max-time "$TIMEOUT_SECONDS" "$url" || true)"
	fi
	if ! SMOKE_BODY="$body" python3 - "$field" <<'PY'
import json
import os
import sys

field = sys.argv[1]
try:
    body = json.loads(os.environ["SMOKE_BODY"])
except json.JSONDecodeError:
    sys.exit(1)

value = body
for part in field.split("."):
    if not isinstance(value, dict) or part not in value:
        sys.exit(1)
    value = value[part]
PY
	then
		echo "${label}: missing JSON field ${field}"
		failures=$((failures + 1))
		return
	fi

	echo "${label}: JSON field ${field}"
}

check_public_status_services_ok() {
	local url="${API_URL%/}/public/status"
	local body

	body="$(curl --silent --show-error --fail --max-time "$TIMEOUT_SECONDS" "$url" || true)"
	if ! SMOKE_BODY="$body" python3 <<'PY'
import json
import os
import sys

try:
    body = json.loads(os.environ["SMOKE_BODY"])
except json.JSONDecodeError:
    print("invalid public status JSON")
    sys.exit(1)

services = body.get("services")
if not isinstance(services, list):
    print("services is not a list")
    sys.exit(1)

by_name = {service.get("name"): service for service in services}
failures = []
for name in ("api", "database", "indexer", "l2_decoder"):
    service = by_name.get(name)
    if not service:
        failures.append(f"missing {name}")
        continue
    status = service.get("status")
    if status != "ok":
        failures.append(f"{name}={status!r}")

if failures:
    print("; ".join(failures))
    sys.exit(1)
PY
	then
		echo "public status required services: unhealthy"
		failures=$((failures + 1))
		return
	fi

	echo "public status required services: ok"
}

check_status "api health" "200" "/health"
check_status "public status" "200" "/public/status"
check_json_field "public status streams freshness" "/public/status" "" "streams.tip.lag_seconds"
check_json_field "public status index freshness" "/public/status" "" "index.decoders"
check_json_field "public status API latency" "/public/status" "" "api.latency.p50_ms"
check_json_field "public status API p95" "/public/status" "" "api.latency.p95_ms"
check_json_field "public status API error rate" "/public/status" "" "api.error_rate"
check_json_field "public status node health" "/public/status" "" "node.status"
check_json_field "public status service health" "/public/status" "" "services"
check_public_status_services_ok
check_json_field "public status reorg signal" "/public/status" "" "reorgs.last_24h"

check_status "streams events build" "200" "/v1/streams/events?limit=1" "$STREAMS_KEY"
check_status "streams events missing auth" "401" "/v1/streams/events?limit=1"
check_status "streams events wrong scope" "403" "/v1/streams/events?limit=1" "$STREAMS_WRONG_SCOPE_KEY"
check_json_field "streams events envelope" "/v1/streams/events?limit=1" "$STREAMS_KEY" "reorgs"

check_status "streams tip public" "200" "/v1/streams/tip" "$STREAMS_STATUS_KEY"
check_status "streams tip missing auth" "401" "/v1/streams/tip"
check_json_field "streams tip shape" "/v1/streams/tip" "$STREAMS_STATUS_KEY" "lag_seconds"

check_status "index ft transfers build" "200" "/v1/index/ft-transfers?limit=1" "$INDEX_KEY"
check_status "index ft transfers missing auth" "401" "/v1/index/ft-transfers?limit=1"
check_status "index ft transfers free" "403" "/v1/index/ft-transfers?limit=1" "$INDEX_FREE_KEY"
check_status "index ft transfers wrong scope" "403" "/v1/index/ft-transfers?limit=1" "$INDEX_WRONG_SCOPE_KEY"
check_json_field "index ft transfers envelope" "/v1/index/ft-transfers?limit=1" "$INDEX_KEY" "reorgs"

check_status "index nft transfers build" "200" "/v1/index/nft-transfers?limit=1" "$INDEX_KEY"
check_status "index nft transfers missing auth" "401" "/v1/index/nft-transfers?limit=1"
check_status "index nft transfers free" "403" "/v1/index/nft-transfers?limit=1" "$INDEX_FREE_KEY"
check_status "index nft transfers wrong scope" "403" "/v1/index/nft-transfers?limit=1" "$INDEX_WRONG_SCOPE_KEY"
check_json_field "index nft transfers envelope" "/v1/index/nft-transfers?limit=1" "$INDEX_KEY" "reorgs"

if [[ "$failures" -gt 0 ]]; then
	echo "post-deploy smoke failed: ${failures}"
	exit 1
fi

echo "post-deploy smoke passed"

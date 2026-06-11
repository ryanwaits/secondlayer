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
	# Services flap transiently right after a deploy (especially l2_decoder, which
	# reports `degraded` while it catches up on indexing lag). Retry within a short
	# grace window before failing so a momentary blip doesn't red an otherwise-good
	# deploy. `l2_decoder=degraded` is tolerated outright — it's data-plane lag, not
	# a deploy regression, and persistent degradation is tracked by Staging Health.
	local retries="${SMOKE_STATUS_RETRIES:-5}"
	local delay="${SMOKE_STATUS_RETRY_DELAY:-8}"
	local attempt=1
	local body result code

	while :; do
		body="$(curl --silent --show-error --fail --max-time "$TIMEOUT_SECONDS" "$url" || true)"
		if result="$(SMOKE_BODY="$body" python3 <<'PY'
import json
import os
import sys

try:
    body = json.loads(os.environ["SMOKE_BODY"])
except json.JSONDecodeError:
    print("retry: invalid public status JSON")
    sys.exit(1)

services = body.get("services")
if not isinstance(services, list):
    print("retry: services is not a list")
    sys.exit(1)

by_name = {service.get("name"): service for service in services}
bad = []
for name in ("api", "database", "indexer"):
    status = (by_name.get(name) or {}).get("status")
    if status != "ok":
        bad.append(f"{name}={status!r}")

# Tolerate a degraded (but present and running) decoder; only a down/missing
# decoder counts against the deploy.
decoder_status = (by_name.get("l2_decoder") or {}).get("status")
if decoder_status not in ("ok", "degraded"):
    bad.append(f"l2_decoder={decoder_status!r}")

if bad:
    print("retry: " + "; ".join(bad))
    sys.exit(1)

print("ok (tolerating l2_decoder=degraded)" if decoder_status == "degraded" else "ok")
sys.exit(0)
PY
		)"; then
			code=0
		else
			code=$?
		fi

		if [[ "$code" -eq 0 ]]; then
			echo "public status required services: ${result}"
			return
		fi

		if [[ "$attempt" -ge "$retries" ]]; then
			echo "public status required services: unhealthy after ${retries} attempts (${result})"
			failures=$((failures + 1))
			return
		fi

		echo "public status services not ready (${result}) — attempt ${attempt}/${retries}, retrying in ${delay}s"
		attempt=$((attempt + 1))
		sleep "$delay"
	done
}

check_status "api health" "200" "/health"

check_deploy_sha_match() {
	if [[ -z "${EXPECTED_DEPLOY_SHA:-}" ]]; then
		echo "deploy sha match: skipped (EXPECTED_DEPLOY_SHA unset)"
		return
	fi
	local url="${API_URL%/}/health"
	local body
	body="$(curl --silent --show-error --fail --max-time "$TIMEOUT_SECONDS" "$url" || true)"
	local got
	got="$(SMOKE_BODY="$body" python3 - <<'PY'
import json, os, sys
try:
    body = json.loads(os.environ["SMOKE_BODY"])
except json.JSONDecodeError:
    sys.exit(1)
sys.stdout.write(str(body.get("image_sha") or ""))
PY
	)"
	if [[ "$got" != "$EXPECTED_DEPLOY_SHA" ]]; then
		echo "deploy sha match: expected ${EXPECTED_DEPLOY_SHA}, got ${got:-<missing>} — the deploy may have silently rolled the previous SHA"
		failures=$((failures + 1))
		return
	fi
	echo "deploy sha match: ${got}"
}
check_deploy_sha_match

check_status "public status" "200" "/public/status"
check_json_field "public status streams freshness" "/public/status" "" "streams.tip.lag_seconds"
check_json_field "public status index freshness" "/public/status" "" "index.decoders"
check_json_field "public status API latency" "/public/status" "" "api.latency.p50_ms"
check_json_field "public status API p95" "/public/status" "" "api.latency.p95_ms"
check_json_field "public status API error rate" "/public/status" "" "api.error_rate"
check_json_field "public status node health" "/public/status" "" "node.status"
check_json_field "public status service health" "/public/status" "" "services"
check_public_status_services_ok

check_status "streams events build" "200" "/v1/streams/events?limit=1" "$STREAMS_KEY"
check_status "streams events missing auth" "401" "/v1/streams/events?limit=1"
check_status "streams events wrong scope" "403" "/v1/streams/events?limit=1" "$STREAMS_WRONG_SCOPE_KEY"
check_json_field "streams events envelope" "/v1/streams/events?limit=1" "$STREAMS_KEY" "reorgs"

check_status "streams tip public" "200" "/v1/streams/tip" "$STREAMS_STATUS_KEY"
check_status "streams tip missing auth" "401" "/v1/streams/tip"
check_json_field "streams tip shape" "/v1/streams/tip" "$STREAMS_STATUS_KEY" "lag_seconds"

check_status "index ft transfers build" "200" "/v1/index/ft-transfers?limit=1" "$INDEX_KEY"
check_status "index ft transfers anon" "200" "/v1/index/ft-transfers?limit=1"
check_status "index ft transfers free" "403" "/v1/index/ft-transfers?limit=1" "$INDEX_FREE_KEY"
check_status "index ft transfers wrong scope" "403" "/v1/index/ft-transfers?limit=1" "$INDEX_WRONG_SCOPE_KEY"
check_json_field "index ft transfers envelope" "/v1/index/ft-transfers?limit=1" "$INDEX_KEY" "reorgs"

check_status "index nft transfers build" "200" "/v1/index/nft-transfers?limit=1" "$INDEX_KEY"
check_status "index nft transfers anon" "200" "/v1/index/nft-transfers?limit=1"
check_status "index nft transfers free" "403" "/v1/index/nft-transfers?limit=1" "$INDEX_FREE_KEY"
check_status "index nft transfers wrong scope" "403" "/v1/index/nft-transfers?limit=1" "$INDEX_WRONG_SCOPE_KEY"
check_json_field "index nft transfers envelope" "/v1/index/nft-transfers?limit=1" "$INDEX_KEY" "reorgs"

# Phase 2: bulk dumps (datasets product removed 2026-06-11)
check_json_field "public status streams dumps" "/public/status" "" "streams.dumps"

# Streams dumps manifest is 200 when STREAMS_BULK_PUBLIC_BASE_URL is set, else 503.
# Either is acceptable; we just check the route exists.
manifest_status="$(curl --silent --output /tmp/secondlayer-smoke-body --write-out '%{http_code}' --max-time "$TIMEOUT_SECONDS" "${API_URL%/}/public/streams/dumps/manifest" || true)"
if [[ "$manifest_status" == "200" || "$manifest_status" == "503" ]]; then
	echo "streams dumps manifest endpoint: $manifest_status"
else
	echo "streams dumps manifest endpoint: unexpected ${manifest_status}"
	failures=$((failures + 1))
fi

if [[ "$failures" -gt 0 ]]; then
	echo "post-deploy smoke failed: ${failures}"
	exit 1
fi

echo "post-deploy smoke passed"

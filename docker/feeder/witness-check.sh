#!/usr/bin/env bash
# Checks a feeder run's vm_events (and state_writes, when present) against the
# node's own MARF with `marf-witness check` (stacks-core contrib/marf-witness).
# Read-only: one single-block SELECT per height, MARF opened read-only.
#
#   witness-check.sh <height>...          check these heights
#   witness-check.sh --sample N           N random heights from 1..(indexed tip - LAG)
#
# Exit 1 on any mismatch; reports land in $OUT, a summary line per height on stdout.
# With SLACK_WEBHOOK_URL set, a failed run posts one line to Slack.
set -uo pipefail

PROJECT="${FEEDER_PROJECT:-secondlayer-feeder}"
PG="${PROJECT}-postgres-feeder-1"
DB_USER="${POSTGRES_USER:-secondlayer}"
DB_NAME="${POSTGRES_DB:-secondlayer_feeder}"
MARF="${FEEDER_MARF:?set FEEDER_MARF to <chainstate>/vm/clarity/marf.sqlite}"
CHECKER="${MARF_WITNESS_BIN:?set MARF_WITNESS_BIN to the marf-witness binary}"
OUT="${WITNESS_OUT:-/data/feeder/witness-checks}"
# Heights resolve on the MARF's latest fork; stay clear of the tip.
LAG="${WITNESS_LAG:-12}"

mkdir -p "$OUT"

sql() {
	docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -qAt \
		-c "SET statement_timeout='10s'" -c "$1"
}

has_state_writes=$(sql "SELECT to_regclass('state_writes') IS NOT NULL")

heights=()
if [[ "${1:-}" == "--sample" ]]; then
	tip=$(sql "SELECT last_indexed_block FROM index_progress LIMIT 1")
	max=$((tip - LAG))
	mapfile -t heights < <(shuf -i "1-$max" -n "${2:?--sample needs a count}")
else
	heights=("$@")
fi

failed=0
for h in "${heights[@]}"; do
	rows="$OUT/rows-$h.jsonl"
	sql "SELECT json_build_object('block_height',block_height,'ordinal',ordinal,'type',type,'tx_id',tx_id,'data',data) FROM vm_events WHERE block_height = $h ORDER BY ordinal" >"$rows"
	args=(check --marf "$MARF" --height "$h" --rows "$rows")
	if [[ "$has_state_writes" == "t" ]]; then
		writes="$OUT/writes-$h.jsonl"
		sql "SELECT json_build_object('block_height',block_height,'tx_index',tx_index,'ordinal',ordinal,'key',key,'value_hex',value_hex) FROM state_writes WHERE block_height = $h ORDER BY ordinal" >"$writes"
		args+=(--writes "$writes")
	fi
	if "$CHECKER" "${args[@]}" >"$OUT/report-$h.json"; then
		echo "$h ok rows=$(wc -l <"$rows")"
	else
		echo "$h FAIL rows=$(wc -l <"$rows") report=$OUT/report-$h.json"
		failed=1
	fi
done
if [[ "$failed" == 1 && -n "${SLACK_WEBHOOK_URL:-}" ]]; then
	bad=$(grep -l '"ok": *false' "$OUT"/report-*.json 2>/dev/null | wc -l)
	text="stacks-feeder witness check FAILED ($PROJECT): $bad block(s) mismatch the chain. Reports: $OUT"
	payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text")
	curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' -d "$payload" "$SLACK_WEBHOOK_URL" >/dev/null || true
fi
exit "$failed"

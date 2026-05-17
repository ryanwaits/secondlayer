#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_UNIT:?DEPLOY_UNIT is required}"
: "${DEPLOY_SHA:?DEPLOY_SHA is required}"

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${HOME:-/root}/.bun/bin:${PATH:-}"

DEPLOY_SCRIPT="/opt/secondlayer/docker/scripts/deploy.sh"
POLL_TIMEOUT_SECONDS="${DEPLOY_POLL_TIMEOUT_SECONDS:-3600}"
POLL_INTERVAL_SECONDS="${DEPLOY_POLL_INTERVAL_SECONDS:-15}"
DEPLOY_IMAGE_TAG="${DEPLOY_IMAGE_TAG:-$DEPLOY_SHA}"

if [[ ! "$DEPLOY_UNIT" =~ ^[A-Za-z0-9_.:@-]+$ ]]; then
	echo "DEPLOY_UNIT contains unsupported characters: ${DEPLOY_UNIT}"
	exit 2
fi

if [[ "$DEPLOY_UNIT" == *.service ]]; then
	UNIT_NAME="$DEPLOY_UNIT"
else
	UNIT_NAME="${DEPLOY_UNIT}.service"
fi

for cmd in systemd-run systemctl journalctl; do
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo "ERROR: ${cmd} not found in PATH"
		exit 1
	fi
done

if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
	echo "ERROR: deploy script not found at ${DEPLOY_SCRIPT}"
	exit 1
fi

print_journal_tail() {
	local lines="${1:-200}"

	echo "Last ${lines} journal lines for ${UNIT_NAME}:"
	journalctl -u "$UNIT_NAME" --no-pager -n "$lines" || true
}

unit_property() {
	local property="$1"

	systemctl show "$UNIT_NAME" --property="$property" --value 2>/dev/null || true
}

fail_from_unit() {
	local active_state="$1"
	local sub_state="$2"
	local result="$3"
	local exec_main_status="$4"

	echo "Deploy unit ${UNIT_NAME} failed: ActiveState=${active_state:-unknown} SubState=${sub_state:-unknown} Result=${result:-unknown} ExecMainStatus=${exec_main_status:-unknown}"
	print_journal_tail 200
	exit 1
}

echo "Starting deploy ${DEPLOY_SHA} as transient systemd unit ${UNIT_NAME}"
systemd-run \
	--unit="$DEPLOY_UNIT" \
	--description="Second Layer deploy ${DEPLOY_SHA}" \
	--property=Type=exec \
	--property=RemainAfterExit=yes \
	--property=WorkingDirectory=/opt/secondlayer \
	--setenv=DEPLOY_SHA="$DEPLOY_SHA" \
	--setenv=DEPLOY_IMAGE_TAG="$DEPLOY_IMAGE_TAG" \
	--setenv=DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-}" \
	--setenv=DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-}" \
	--setenv=HOME="${HOME:-/root}" \
	--setenv=PATH="$PATH" \
	/bin/bash "$DEPLOY_SCRIPT"

deadline=$((SECONDS + POLL_TIMEOUT_SECONDS))

# Operator-friendly polling: print the unit state line only when it changes
# (otherwise it spams the same `ActiveState=active SubState=running` line every
# 15s for the whole deploy duration), and tail the unit's journal every
# JOURNAL_TAIL_INTERVAL_SECONDS so the SSH log shows live progress from
# deploy.sh instead of a wall of identical state lines.
JOURNAL_TAIL_INTERVAL_SECONDS="${DEPLOY_JOURNAL_TAIL_INTERVAL_SECONDS:-60}"
JOURNAL_TAIL_LINES="${DEPLOY_JOURNAL_TAIL_LINES:-40}"
last_state_key=""
last_journal_tail_at=$((SECONDS - JOURNAL_TAIL_INTERVAL_SECONDS))

while ((SECONDS < deadline)); do
	active_state="$(unit_property ActiveState)"
	sub_state="$(unit_property SubState)"
	result="$(unit_property Result)"
	exec_main_status="$(unit_property ExecMainStatus)"

	state_key="${active_state:-unknown}/${sub_state:-unknown}/${result:-unknown}/${exec_main_status:-unknown}"
	if [[ "$state_key" != "$last_state_key" ]]; then
		echo "Deploy unit ${UNIT_NAME}: ActiveState=${active_state:-unknown} SubState=${sub_state:-unknown} Result=${result:-unknown} ExecMainStatus=${exec_main_status:-unknown}"
		last_state_key="$state_key"
	fi

	if [[ "$active_state" == "active" ]] && (( SECONDS - last_journal_tail_at >= JOURNAL_TAIL_INTERVAL_SECONDS )); then
		echo "--- ${UNIT_NAME} journal (last ${JOURNAL_TAIL_LINES} lines) ---"
		journalctl -u "$UNIT_NAME" --no-pager -n "$JOURNAL_TAIL_LINES" || true
		echo "--- end journal tail ---"
		last_journal_tail_at=$SECONDS
	fi

	if [[ "$active_state" == "failed" ]]; then
		fail_from_unit "$active_state" "$sub_state" "$result" "$exec_main_status"
	fi

	if [[ -n "$result" && "$result" != "success" ]]; then
		fail_from_unit "$active_state" "$sub_state" "$result" "$exec_main_status"
	fi

	if [[ "$exec_main_status" != "" && "$exec_main_status" != "0" ]]; then
		fail_from_unit "$active_state" "$sub_state" "$result" "$exec_main_status"
	fi

	if [[ "$sub_state" == "exited" || "$active_state" == "inactive" ]]; then
		if [[ "${result:-success}" == "success" && "${exec_main_status:-0}" == "0" ]]; then
			echo "Deploy unit ${UNIT_NAME} completed successfully"
			exit 0
		fi
		fail_from_unit "$active_state" "$sub_state" "$result" "$exec_main_status"
	fi

	sleep "$POLL_INTERVAL_SECONDS"
done

echo "Timed out after ${POLL_TIMEOUT_SECONDS}s waiting for ${UNIT_NAME}; leaving the host unit running for inspection."
echo "Inspect with: systemctl status ${UNIT_NAME}"
echo "Follow logs with: journalctl -u ${UNIT_NAME} -f"
exit 124

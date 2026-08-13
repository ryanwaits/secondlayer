#!/usr/bin/env bash
# Bash helpers for long-running Monitor scripts that poll remote state.
#
# The pattern that keeps biting long-running monitors:
#
#   still=$(ssh host "docker exec c ps | grep foo | wc -l" 2>/dev/null | tr -d '[:space:]')
#   if [ "$still" = "0" ]; then break; fi
#
# When ssh, dockerd, or the network blips for one poll cycle, the capture
# returns empty. Empty is not "0", so the loop keeps waiting — forever, on
# work that already finished. The monitor looks alive; the job it was
# watching is long gone.
#
# The fix is to treat "I got a value" and "the value means done" as two
# separate questions. These helpers do that.
#
# Source this file at the top of a Monitor bash script:
#
#   source scripts/ops/monitor-helpers.sh    # if running from repo root
#
# ...or paste the two functions inline if you can't source (Monitor scripts
# run in a fresh shell that doesn't have the repo mounted).

# ssh_try — run a command over ssh, echo its stdout, exit code = did we get
# a real answer?  Retries on transient failure up to `attempts` times with a
# short backoff. Empty stdout is treated as failure — a successful command
# that legitimately produces nothing is not what this helper is for.
#
# Usage:  value=$(ssh_try host "command..." [attempts])
#         if value came back, $? == 0 and value holds the output
#         if we never got a real answer, $? == 1 and value is empty
ssh_try() {
	local host="$1" cmd="$2" attempts="${3:-3}"
	local i out
	for i in $(seq 1 "$attempts"); do
		if out=$(ssh -o ConnectTimeout=10 "$host" "$cmd" 2>/dev/null); then
			out=$(printf '%s' "$out" | tr -d '[:space:]')
			if [ -n "$out" ]; then
				printf '%s' "$out"
				return 0
			fi
		fi
		sleep 2
	done
	return 1
}

# poll_ssh_until — poll a remote command every `interval` seconds until its
# output exactly matches `want`. Empty output means "transient blip, retry";
# only a real, matching answer breaks the loop. Fails after `max_seconds`
# without ever seeing the target value.
#
# Usage:  poll_ssh_until <interval> <max_seconds> <host> <want> <cmd>
#         → 0 when we see `want`
#         → 1 on timeout without ever seeing it
poll_ssh_until() {
	local interval="$1" max="$2" host="$3" want="$4" cmd="$5"
	local elapsed=0 got
	while [ "$elapsed" -lt "$max" ]; do
		if got=$(ssh_try "$host" "$cmd" 1); then
			if [ "$got" = "$want" ]; then
				return 0
			fi
		fi
		sleep "$interval"
		elapsed=$((elapsed + interval))
	done
	return 1
}

# wait_for_container_process_gone — the specific case we hit twice on
# 2026-08-13: watch for a process INSIDE a docker container to disappear.
# Wraps the ssh + docker exec + pgrep dance with the transient-blip guard.
#
# Usage: wait_for_container_process_gone <host> <container> <pgrep-pattern> \
#          [interval_secs=60] [max_secs=14400]
#        → 0 when the process is gone
#        → 1 on timeout
wait_for_container_process_gone() {
	local host="$1" container="$2" pattern="$3"
	local interval="${4:-60}" max="${5:-14400}"
	local elapsed=0
	while [ "$elapsed" -lt "$max" ]; do
		# `pgrep -f pattern; echo $?` — the echoed exit code is the answer we
		# actually want. Empty output from a transient ssh failure is not "0",
		# so we don't falsely conclude the process is gone.
		local out
		if out=$(ssh_try "$host" \
			"docker exec $container pgrep -f '$pattern' >/dev/null; echo \$?" 1); then
			if [ "$out" = "1" ]; then
				return 0
			fi
		fi
		sleep "$interval"
		elapsed=$((elapsed + interval))
	done
	return 1
}

# If invoked directly (not sourced), print usage. Sourcing is the intended
# use — inline calls to the helpers is how a Monitor script picks them up.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	cat <<'USAGE'
scripts/ops/monitor-helpers.sh — bash helpers for robust long-running Monitor scripts.

Source this file, then use:
  ssh_try <host> <cmd> [attempts]
  poll_ssh_until <interval> <max> <host> <want> <cmd>
  wait_for_container_process_gone <host> <container> <pattern> [interval] [max]

Each treats an empty/transient response as "retry" rather than "done" — the
class of bug that made a monitor wait forever on a job that had already
finished.
USAGE
	exit 0
fi

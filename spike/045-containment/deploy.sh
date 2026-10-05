#!/usr/bin/env bash
# Deploy one subgraph source into a tenant stack through its own api
# (bundle, then deploy), the same two calls the CLI makes.
#
# Usage: deploy.sh <api-port> <env-file> <subgraph.ts> [nonce]
# The instance token is read from the env file and sent only as a header
# from a curl config on stdin (never on a command line, never printed).
set -euo pipefail

port="${1:?api port}"
env_file="${2:?env file}"
src="${3:?subgraph source}"
nonce="${4:-}"

token="$(grep '^INSTANCE_TOKEN=' "$env_file" | cut -d= -f2-)"
base="http://127.0.0.1:${port}/api/subgraphs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ -n "${DELETE_FIRST:-}" ]; then
	printf 'header = "Authorization: Bearer %s"\n' "$token" |
		curl -sS -K - -X DELETE "$base/$DELETE_FIRST" -o /dev/null -w 'delete http=%{http_code}\n'
fi

call() { # call <path> <json-body-file>
	printf 'header = "Authorization: Bearer %s"\n' "$token" |
		curl -sS -K - -X POST "$base$1" -H 'content-type: application/json' \
			--data-binary "@$2" -w '\n%{http_code}\n'
}

{
	cat "$src"
	if [ -n "$nonce" ]; then printf '\n// nonce %s\n' "$nonce"; fi
} | jq -Rs '{code: .}' >"$tmp/bundle-req.json"

call /bundle "$tmp/bundle-req.json" >"$tmp/bundle-res.txt"
code="$(tail -n1 "$tmp/bundle-res.txt")"
if [ "$code" != "200" ]; then
	echo "bundle failed ($code): $(head -c 600 "$tmp/bundle-res.txt")" >&2
	exit 1
fi
sed '$d' "$tmp/bundle-res.txt" |
	jq '{name, sources, schema, handlerCode, sourceCode}' >"$tmp/deploy-req.json"

call "" "$tmp/deploy-req.json" >"$tmp/deploy-res.txt"
code="$(tail -n1 "$tmp/deploy-res.txt")"
echo "deploy http=$code $(sed '$d' "$tmp/deploy-res.txt" | head -c 600)"
[ "$code" = "200" ] || [ "$code" = "201" ]

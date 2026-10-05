#!/usr/bin/env bash
# Throwaway tenant env file, same keys as packages/workload provisioner's
# buildTenantEnv/generateTenantSecrets (random token/password/secrets key,
# fresh ed25519 PEM pairs, PEM newlines as literal \n like renderEnvFile).
#
# Usage: READ_KEY=<hosted read key> gen-env.sh <out-file> <api-port> <socket-dir>
# The read key arrives via the environment (never argv) and lands only in the
# mode-600 output file; it is never echoed.
set -euo pipefail
umask 077

out="${1:?out file}"
api_port="${2:?api port}"
socket_dir="${3:?socket dir}"
read_key="${READ_KEY:?READ_KEY env}"

pem() { openssl genpkey -algorithm ed25519 | awk '{printf "%s%s", sep, $0; sep="\\n"}'; }

{
	echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
	echo "INSTANCE_TOKEN=$(openssl rand -hex 32)"
	echo "SECONDLAYER_SECRETS_KEY=$(openssl rand -hex 32)"
	echo "STREAMS_SIGNING_PRIVATE_KEY=$(pem)"
	echo "SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY=$(pem)"
	echo "HOSTED_API_URL=https://api.secondlayer.tools"
	echo "TENANT_HOSTED_READ_KEY=${read_key}"
	echo "TENANT_SOCKET_DIR=${socket_dir}"
	echo "TENANT_API_PORT=${api_port}"
} >"$out"
chmod 600 "$out"

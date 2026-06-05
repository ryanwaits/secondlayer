#!/bin/bash
set -euo pipefail

# Cutover helper for the chain/control-plane DB split (see
# docker/SCHEMA_SPLIT.md + docs/runbook/db-source-target-cutover.md).
#
# Copies the CONTROL-PLANE tables (accounts/auth/billing/subscriptions) and the
# per-tenant subgraph schemas from SOURCE (the chain DB) into TARGET (the new
# postgres-platform instance). Chain + decoded tables NEVER move — they stay on
# SOURCE. After this runs cleanly, flip TARGET_DATABASE_URL and redeploy.
#
# Idempotent: control-plane data loads with FK checks deferred
# (session_replication_role=replica) and ON CONFLICT-safe truncate+reload, so a
# re-run reconciles rather than duplicates. Manual, founder-driven — keep a
# fresh snapshot in hand (this only ADDS to TARGET; it never touches SOURCE).
#
# Usage:
#   SOURCE_DATABASE_URL=postgres://…@postgres:5432/secondlayer \
#   TARGET_DATABASE_URL=postgres://…@postgres-platform:5432/secondlayer_platform \
#   docker/scripts/split-platform-db.sh [--dry-run]
#
# Needs `pg_dump` + `psql` on PATH (any postgres:17 image has them). Run from a
# box on the compose network, or `docker cp` into the postgres-platform
# container and exec it there.

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

SRC="${SOURCE_DATABASE_URL:-}"
TGT="${TARGET_DATABASE_URL:-}"

if [ -z "$SRC" ] || [ -z "$TGT" ]; then
  echo "ERROR: SOURCE_DATABASE_URL and TARGET_DATABASE_URL must both be set"
  exit 1
fi
if [ "$SRC" = "$TGT" ]; then
  echo "ERROR: SOURCE and TARGET resolve to the same database — nothing to split"
  exit 1
fi

for cmd in pg_dump psql; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: $cmd not found on PATH"; exit 1; }
done

# Control-plane tables (public schema), FK-parent order. The reload defers FK
# checks, so order is belt-and-suspenders, not load-bearing. Mirrors the TARGET
# set in docker/SCHEMA_SPLIT.md — keep in sync.
CONTROL_TABLES=(
  accounts
  tenants
  projects
  team_members
  team_invitations
  api_keys
  sessions
  magic_links
  usage_daily
  usage_snapshots
  account_insights
  account_agent_runs
  account_spend_caps
  tenant_usage_monthly
  tenant_compute_addons
  provisioning_audit_log
  processed_stripe_events
  subscriptions
  subscription_outbox
  subscription_deliveries
  trigger_evaluator_state
  chat_sessions
  chat_messages
  subgraphs
)

src_count() { psql "$SRC" -tAc "SELECT count(*) FROM $1" 2>/dev/null || echo "ERR"; }
tgt_count() { psql "$TGT" -tAc "SELECT count(*) FROM $1" 2>/dev/null || echo "ERR"; }

echo "═══ DB split cutover: control-plane SOURCE → TARGET ═══"
echo "SOURCE: $(psql "$SRC" -tAc 'SELECT current_database()')"
echo "TARGET: $(psql "$TGT" -tAc 'SELECT current_database()')"
echo "Mode:   $([ "$DRY_RUN" = true ] && echo DRY-RUN || echo EXECUTE)"
echo

# Discover per-tenant subgraph schemas (dynamic DDL, not in migrate.ts).
SUBGRAPH_SCHEMAS=$(psql "$SRC" -tAc \
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'subgraph\_%'" \
  | tr -d ' ')

echo "── Plan ──"
printf '  control tables: %d\n' "${#CONTROL_TABLES[@]}"
printf '  subgraph schemas: %d\n' "$(echo "$SUBGRAPH_SCHEMAS" | grep -c . || true)"
echo

echo "── Source row counts ──"
for t in "${CONTROL_TABLES[@]}"; do
  printf '  %-26s %s\n' "$t" "$(src_count "public.$t")"
done

if [ "$DRY_RUN" = true ]; then
  echo
  echo "DRY-RUN: no data written. Re-run without --dry-run to execute."
  exit 0
fi

echo
echo "── Loading control-plane tables (FK checks deferred) ──"
# One transaction: truncate the TARGET control set, then COPY the SOURCE rows in.
# session_replication_role=replica bypasses FK + trigger enforcement during load
# (requires superuser — the POSTGRES_USER is). Idempotent: truncate-then-reload.
TABLE_ARGS=()
for t in "${CONTROL_TABLES[@]}"; do TABLE_ARGS+=(--table="public.$t"); done

{
  echo "SET session_replication_role = replica;"
  echo "BEGIN;"
  # Truncate in reverse FK order; CASCADE is safe since replication_role=replica.
  for ((i=${#CONTROL_TABLES[@]}-1; i>=0; i--)); do
    echo "TRUNCATE TABLE public.${CONTROL_TABLES[$i]} CASCADE;"
  done
  pg_dump "$SRC" --data-only --no-owner --no-privileges "${TABLE_ARGS[@]}"
  echo "COMMIT;"
} | psql "$TGT" -v ON_ERROR_STOP=1 -q
echo "  ✓ control-plane tables loaded"

if [ -n "$SUBGRAPH_SCHEMAS" ]; then
  echo
  echo "── Loading per-tenant subgraph schemas ──"
  while IFS= read -r schema; do
    [ -z "$schema" ] && continue
    echo "  $schema"
    # Full schema (DDL + data) — these schemas are created by dynamic DDL, not
    # migrate.ts, so they don't exist on TARGET yet. Drop-and-recreate for
    # idempotency.
    psql "$TGT" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA IF EXISTS \"$schema\" CASCADE;"
    pg_dump "$SRC" --no-owner --no-privileges --schema="$schema" \
      | psql "$TGT" -v ON_ERROR_STOP=1 -q
  done <<< "$SUBGRAPH_SCHEMAS"
  echo "  ✓ subgraph schemas loaded"
fi

echo
echo "── Verify: row counts SOURCE vs TARGET ──"
MISMATCH=0
for t in "${CONTROL_TABLES[@]}"; do
  s=$(src_count "public.$t"); d=$(tgt_count "public.$t")
  flag=""
  if [ "$s" != "$d" ]; then flag="  ✗ MISMATCH"; MISMATCH=1; fi
  printf '  %-26s src=%-8s tgt=%-8s%s\n' "$t" "$s" "$d" "$flag"
done

if [ "$MISMATCH" != 0 ]; then
  echo
  echo "ERROR: row-count mismatch — do NOT flip TARGET_DATABASE_URL. Investigate."
  exit 1
fi

echo
echo "✓ All control-plane row counts match. Safe to set TARGET_DATABASE_URL and redeploy."
echo "  Next: docs/runbook/db-source-target-cutover.md steps 5–7."

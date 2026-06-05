# Runbook: chain/control-plane database cutover

Moves the **control plane** (accounts, api keys, sessions, usage, subscriptions,
subgraphs/tenant schemas) off the shared Postgres onto a dedicated
`postgres-platform` instance, isolating it from the chain plane. The chain data
**never moves** — it stays on the existing instance, which becomes SOURCE. See
`docker/SCHEMA_SPLIT.md` for the table split and `ARCHITECTURE.md` for why.

**Manual, founder-driven.** Touches prod auth/billing data; do it deliberately
with a snapshot in hand. All supporting code is already merged and is a no-op
until `SOURCE_/TARGET_DATABASE_URL` are set, so there is no rush.

Prereqs: the code is deployed (writes already route to `getSourceDb()`; in
single-DB that's the current DB). Pick a low-traffic window — every push to main
triggers a Deploy with a 1–2 min 502.

## Steps

1. **Snapshot.** Confirm a fresh wal-g base backup exists (see
   `db-backup-restore.md`). This is the rollback path. Do not proceed without it.

2. **Start the platform DB.**
   ```
   ssh ryan@claude-mini → ssh app-server
   cd /opt/secondlayer/docker
   docker compose --profile split up -d postgres-platform
   docker exec secondlayer-postgres-platform-1 pg_isready -U secondlayer
   ```

3. **Migrate the platform schema into it.** Run migrate with both URLs so the
   full schema lands on the new instance (chain tables sit empty there):
   ```
   SOURCE_DATABASE_URL=postgres://…@postgres:5432/secondlayer \
   TARGET_DATABASE_URL=postgres://…@postgres-platform:5432/secondlayer_platform \
   docker compose run --rm --no-deps migrate
   ```
   NEVER `docker compose run` a service with `depends_on: postgres` — it can
   recreate the chain volume. `--no-deps` avoids that.

4. **Copy the control-plane tables** (small — megabytes) from SOURCE to TARGET,
   FK-parent order first (`accounts` before its children). Use
   `pg_dump --data-only --table=…` per the SCHEMA_SPLIT TARGET list, restore into
   `postgres-platform`. Verify row counts match per table.

5. **Flip the env.** In `.env` set:
   ```
   SOURCE_DATABASE_URL=postgres://…@postgres:5432/secondlayer
   TARGET_DATABASE_URL=postgres://…@postgres-platform:5432/secondlayer_platform
   ```
   Leave `DATABASE_URL` set (harmless fallback) or remove it to force explicit
   config. Redeploy. On boot `assertDbSplit()` logs an error if the two still
   collapse to one DB — watch for it.

6. **Verify.** `current_database()` differs between `getSourceDb()` and
   `getTargetDb()` (smoke via `/health` + a query). Confirm login, API-key auth,
   billing/usage writes hit `postgres-platform`, and ingest + datasets/subgraphs
   read/write `postgres`. Check ingest lag and the status page.

7. **Later (after a stability window): drop** the migrated control-plane tables
   from SOURCE to reclaim space — irreversible, so only after a clean snapshot
   and confirmed-healthy split.

## Rollback

Unset `SOURCE_/TARGET_DATABASE_URL` (both fall back to `DATABASE_URL` → original
single DB) and redeploy. If the control-plane data on SOURCE was already dropped
(step 7), restore from the wal-g snapshot instead.

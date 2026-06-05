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

2. **Confirm the platform DB is up.** `postgres-platform` is default-on (no
   longer profile-gated), so it should already be running:
   ```
   ssh ryan@claude-mini → ssh app-server
   cd /opt/secondlayer/docker
   docker compose up -d postgres-platform   # no-op if already running
   docker exec secondlayer-postgres-platform-1 pg_isready -U secondlayer
   ```

3. **Migrate + copy via the cutover script.** `docker/scripts/split-platform-db.sh`
   migrates the schema into `postgres-platform`, then copies the control-plane
   tables (FK checks deferred) and per-tenant subgraph schemas from SOURCE.
   Idempotent (truncate-then-reload), and it NEVER writes to SOURCE. Dry-run
   first, then execute — both print per-table SOURCE/TARGET row counts:
   ```
   export SRC=postgres://…@postgres:5432/secondlayer
   export TGT=postgres://…@postgres-platform:5432/secondlayer_platform
   # dual-migrate the schema onto the platform DB (--no-deps: never recreate the
   # chain volume — the postgres footgun):
   SOURCE_DATABASE_URL=$SRC TARGET_DATABASE_URL=$TGT \
     docker compose run --rm --no-deps migrate
   # copy control-plane data + verify row counts (run inside a box with pg
   # client tools, e.g. the platform container):
   SOURCE_DATABASE_URL=$SRC TARGET_DATABASE_URL=$TGT \
     docker/scripts/split-platform-db.sh --dry-run
   SOURCE_DATABASE_URL=$SRC TARGET_DATABASE_URL=$TGT \
     docker/scripts/split-platform-db.sh
   ```
   The script exits non-zero on any row-count mismatch — do not proceed if it does.

4. **Flip the env + remove `DATABASE_URL`.** In `.env` set:
   ```
   SOURCE_DATABASE_URL=postgres://…@postgres:5432/secondlayer
   TARGET_DATABASE_URL=postgres://…@postgres-platform:5432/secondlayer_platform
   ```
   and **remove `DATABASE_URL`** so a missing/typo'd split var surfaces loudly
   rather than silently collapsing both getters back to one DB. On boot
   `assertDbSplit()` errors if either var is unset (it would otherwise resolve to
   the built-in dev `DEFAULT_URL`) or if the two still collapse. Redeploy.

5. **Verify.** `GET /status` (or `/public/status`) now carries a
   `database.split` block — confirm `active: true` with distinct `sourceDb` /
   `targetDb`. Confirm login, API-key auth, billing/usage writes hit
   `postgres-platform`, and ingest + datasets/subgraphs read/write `postgres`.
   Check ingest lag and the status page.

6. **Later (after a stability window): drop** the migrated control-plane tables
   from SOURCE to reclaim space — irreversible, so only after a clean snapshot
   and confirmed-healthy split.

## Rollback

Re-add `DATABASE_URL` and unset `SOURCE_/TARGET_DATABASE_URL` (both fall back to
`DATABASE_URL` → original single DB) and redeploy. If the control-plane data on
SOURCE was already dropped (step 6), restore from the wal-g snapshot instead.

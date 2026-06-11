# Runbook: chain/control-plane database cutover

Moves the **control plane** (accounts, api keys, sessions, usage, subscriptions,
subgraphs/tenant schemas) off the shared Postgres onto a dedicated
`postgres-platform` instance, isolating it from the chain plane. The chain data
**never moves** — it stays on the existing instance, which becomes SOURCE. See
`docker/SCHEMA_SPLIT.md` for the table split and `STRATEGY.md` for why.

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

   **Freeze writers for the FINAL copy.** High-churn control tables (e.g.
   `subgraph_processing_stats`, `sessions`, `usage_*`) are written continuously,
   so a copy with the app live drifts by a row or two (the script will flag it).
   For a consistent cutover, stop the control-plane writers, run the copy, then
   flip — chain ingest (indexer/l2-decoder) can keep running:
   ```
   docker compose -f docker-compose.yml -f docker-compose.hetzner.yml \
     stop api subgraph-processor worker
   # …run the copy (now consistent)… then bring services back up after the flip.
   ```

4. **Flip the env + blank `DATABASE_URL`.** In `.env` set:
   ```
   SOURCE_DATABASE_URL=postgres://…@postgres:5432/secondlayer
   TARGET_DATABASE_URL=postgres://…@postgres-platform:5432/secondlayer_platform
   DATABASE_URL=
   ```
   Blanking `DATABASE_URL` (the overridable compose keeps the empty value) makes a
   missing/typo'd split var fail loud via `DEFAULT_URL` instead of silently
   collapsing both getters back to one DB. The LISTEN/NOTIFY listener is now
   split-aware (`queue/listener.ts` `sourceListenerUrl()`/`targetListenerUrl()`),
   so it no longer needs `DATABASE_URL`. On boot `assertDbSplit()` errors if a
   split var is unset (→ `DEFAULT_URL`) or if the two collapse. Redeploy.

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

## Notes (learned in the 2026-06-05 prod cutover)

- **Connection headroom.** Pre-split, running N>1 api replicas against the single
  Postgres can exhaust `max_connections` (each process holds a ~20-conn pool;
  many sit idle). The split itself relieves this — worker + subgraph-processor
  move entirely to TARGET. Source `max_connections` was bumped 100→200 (in
  `docker-compose.hetzner.yml`, applied via `up -d postgres` — deploy.sh never
  recreates postgres). If you cut over with replicas already at N>1 and hit
  "too many clients", scale api to 1 first (`API_REPLICAS=1`, `up -d api`), cut
  over, then scale back up.
- **Readers must source-read chain/decoded.** Any reader that touches chain or
  decoded tables (`blocks`, `l2_decoder_checkpoints`, `decoded_events`, …) must
  use `getSourceDb()`, not `getDb()`/`getTargetDb()` — under the active split the
  latter point at TARGET, where those tables exist but are empty (false
  "degraded"). `/status` l2-health + chain-integrity were fixed for this.
- **LISTEN/NOTIFY listener is split-aware (resolved 2026-06-05).**
  `queue/listener.ts` exports `sourceListenerUrl()` / `targetListenerUrl()`; the
  subgraph-processor binds `indexer:new_block`/`subgraph_reorg` to SOURCE and the
  subscriptions emitter (`subscriptions:new_outbox`/`:changed`) + subgraph
  operations to TARGET. `DATABASE_URL` is now blanked in split prod
  (shared@6.21.0). Earlier blanking it crashed the processor because the emitter
  fell back to `DATABASE_URL`; fixed.

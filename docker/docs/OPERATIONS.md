# Operations Runbook

Living checklist for operating the production stack as we roll out dedicated hosting. Covers env vars you need to set, commands to verify state, and what's coming in upcoming sprints.

For Phase 1 single-server recovery, backup verification, post-recovery smoke checks, and drill evidence, use [`PHASE1_RECOVERY_RUNBOOK.md`](PHASE1_RECOVERY_RUNBOOK.md).

Last updated after dedicated-hosting cutover + Phase 4 hardening (per-tenant backups, bastion, audit log).

---

## 1. Current prod env vars

All on `/opt/secondlayer/docker/.env` on the app server. After editing, run:

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
$COMPOSE up -d --force-recreate api indexer worker agent
```

### Required (set already, don't break)

| Var | Used by | Purpose |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres, all services | DB auth |
| `SECONDLAYER_SECRETS_KEY` | api, worker, indexer | 32-byte hex — AES-GCM envelope key for encrypted DB columns (subscription signing secrets, tenant JWT secrets). Rotate = re-encrypt every row + swap env. Do NOT lose this value — encrypted columns become unreadable. OSS auto-generates on first boot into `./data/secrets/master.key`. |
| `RESEND_API_KEY` | api | Magic-link email |
| `STACKS_NODE_RPC_URL` | api, indexer | Node server endpoint |
| `NODE_SERVER_URL` | agent | AI-ops monitoring |
| `NETWORKS` | worker, indexer | `mainnet` / comma-separated |

### New for Sprint 5 (set these before enabling provisioner in Sprint 6-7)

| Var | Default | Purpose |
|---|---|---|
| `INSTANCE_MODE` | `platform` | `platform` = shared multi-tenant (current). `oss` = self-host. `dedicated` = per-tenant. Must be `platform` on the main app server. |
| `PROVISIONER_SECRET` | — (required when provisioner runs) | Shared secret platform-API ↔ provisioner. `openssl rand -hex 32`. |
| `PROVISIONER_SOURCE_DB_READONLY_PASSWORD` | — (required when provisioner runs) | Password for the `secondlayer_readonly` role the provisioner creates on the source DB. Tenants get URLs built with this role. Rotate = provisioner restart. `openssl rand -hex 24`. |
| `DEPLOY_IMAGE_OWNER` / `PROVISIONER_IMAGE_OWNER` | `secondlayer-labs` | GHCR owner for platform and tenant images. Deploy sets `PROVISIONER_IMAGE_OWNER` from `DEPLOY_IMAGE_OWNER`. |
| `DEPLOY_IMAGE_TAG` / `PROVISIONER_IMAGE_TAG` | commit SHA | GHCR image tag for platform and tenant images. Deploy sets `PROVISIONER_IMAGE_TAG` from the exact deployed SHA. |
| `DEPLOY_STATE_DIR` | `/opt/secondlayer/data/deploy` | Stores `current`, `previous`, and deploy metadata for image-only rollback. |
| `PROVISIONER_TENANT_BASE_DOMAIN` | `secondlayer.tools` | Base domain for `{slug}.{base}` tenant URLs. |
| `PROVISIONER_SOURCE_DB_HOST` | `postgres:5432` | Docker-network hostname for the source DB. Tenant containers connect here. |
| `STACKS_NODE_RPC_URL` | — (required when provisioner runs) | Node RPC injected into tenant API and processor containers for ABI fetches and Stacks reads. |
| `HIRO_API_URL` / `HIRO_API_KEY` | optional | Hiro API settings injected into tenant API and processor containers. |

**NOT required yet** because the provisioner service is behind `--profile platform` and the current deploy script doesn't start it. The routes `/api/tenants/*` and worker trial/health crons are already deployed but all short-circuit when no tenants exist (zero provisioner calls). Set these before activating the provisioner.

### Tenant HTTPS (Caddy wildcard + on-demand TLS)

Caddy serves `api.{BASE_DOMAIN}` (platform API) and `*.{BASE_DOMAIN}` (tenant subdomains). On-demand TLS issues a Let's Encrypt cert the first time a new `{slug}.{BASE_DOMAIN}` is requested, after checking with the provisioner's `ask` endpoint that the slug is a real tenant.

| Var | Purpose |
|---|---|
| `BASE_DOMAIN` | Apex domain served by Caddy, e.g. `secondlayer.tools`. Caddy matches `api.{BASE_DOMAIN}` and `*.{BASE_DOMAIN}`. |
| `CADDY_ACME_EMAIL` | Let's Encrypt account email. |

**DNS requirement**: wildcard A record `*.{BASE_DOMAIN}` → app-server IP (proxy-off / DNS-only). Works on any DNS provider (Vercel, Namecheap, Cloudflare, etc.).

---

## 2. State-check commands

SSH into app server first: `ssh app-server`

### Migration state

```bash
# Which migrations have applied?
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT name, executed_at FROM kysely_migration ORDER BY name;"

# Should end with: 0039_tenants (latest as of Sprint 5)
```

### Active DB sessions (if migration ever hangs again)

```bash
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT pid, state, wait_event_type, wait_event, substring(query, 1, 80) as query
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid();"

# If stuck: terminate zombies
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid();"
```

### Service health

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# All containers + state
$COMPOSE ps

# Logs (last 100 lines, follow)
$COMPOSE logs -f --tail 100 api
$COMPOSE logs -f --tail 100 worker
$COMPOSE logs -f --tail 100 indexer

# API health
curl -s http://localhost:3800/health | jq
# Indexer health
curl -s http://localhost:3700/health | jq
```

### Tenant state (after provisioner activated)

```bash
# Tenant rows
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT slug, plan, status, last_active_at, storage_used_mb, storage_limit_mb FROM tenants;"

# Running tenant containers
docker ps --filter "label=secondlayer.slug" --format \
  "table {{.Names}}\t{{.Status}}\t{{.Label \"secondlayer.slug\"}}\t{{.Label \"secondlayer.role\"}}"

# Resource usage by tenant
docker stats --no-stream --filter "label=secondlayer.slug"
```

### Orphan containers (services removed from compose but still running)

```bash
# Any secondlayer-* containers NOT owned by a current compose service?
docker ps -a --filter "name=secondlayer-" --format "{{.Names}}\t{{.Status}}" \
  | grep -v "secondlayer-postgres\|secondlayer-api\|secondlayer-indexer\|secondlayer-worker\|secondlayer-agent\|secondlayer-caddy\|secondlayer-migrate\|secondlayer-provisioner\|secondlayer-bastion"

# If you see leftovers, force-remove:
docker rm -f <name>
```

---

## 3. Deploy flow (what happens on every push to main)

GitHub builds and pushes GHCR images for `api`, `indexer`, `worker`, `agent`, and `provisioner` before deploy starts. Images are tagged with the full commit SHA. GitHub then starts deploys over SSH through `scripts/ci/remote-deploy-systemd.sh`. The wrapper creates a transient systemd unit named like `secondlayer-deploy-<run_id>-<run_attempt>` and runs `/opt/secondlayer/docker/scripts/deploy.sh` inside that unit. The deploy script remains the source of truth for image pull, migration, restart, tenant refresh, and health checks.

An SSH interruption no longer kills image pulls, migration, or restart. The wrapper observes the host unit for up to 60 minutes, and the GitHub SSH command allows 65 minutes. If GitHub still cannot observe completion, the host unit keeps running and can be inspected.

Daily shared Postgres backup validation normally runs around `03:00-03:45 CEST`. Deploy waits on `/opt/secondlayer/data/db-maintenance.lock` for up to 45 minutes before stopping database writers or terminating sessions. It must wait for an active backup instead of interrupting `pg_dump`.

```bash
# Replace with the unit name printed by the GitHub deploy job.
systemctl status secondlayer-deploy-<run_id>-<run_attempt>.service
journalctl -u secondlayer-deploy-<run_id>-<run_attempt>.service -f
```

`/opt/secondlayer/docker/scripts/deploy.sh` does:

1. **git fetch + reset** (source update)
2. **exec-reload** — re-exec the updated deploy.sh so we don't run old buffered content
3. **pull exact images** — GHCR images tagged by `DEPLOY_IMAGE_TAG`
4. **wait for DB maintenance lock** — `/opt/secondlayer/data/db-maintenance.lock`, shared with daily backup validation
5. **stop lock-holders** — `api`, `indexer`, `l2-decoder`, `agent`, `worker`
6. **force-remove orphan containers** — named-removed services from old deploys
7. **clean zombie migrate containers** — prior `--rm` runs killed by SSH timeout
8. **terminate DB sessions** — every non-self session on the DB, clean slate for DDL
9. **run migrations** — `--rm migrate` from the pulled API image
10. **up -d --no-build** — restart all app services
11. **health check** — curl api, indexer, provisioner, and l2-decoder health
12. **tenant refresh** — active tenants resume onto the exact deployed API image
13. **record state** — write current/previous deploy SHAs under `DEPLOY_STATE_DIR`

Deploy fails before stopping services if any required image for the SHA is missing from GHCR.

If GHCR packages are private, the app server must be logged in before deploy:

```bash
docker login ghcr.io
```

---

## 4. Common problems + remedies

### "Migration timed out / deploy failed"

The new migrate.ts prints `pg_stat_activity` on failure. Look for:
- Any `wait_event=Lock/relation` on the table being migrated
  → A service wasn't stopped. Add it to `MIGRATION_LOCK_HOLDERS` in `deploy.sh`.
- Any `pg_advisory_xact_lock(...)` waiters with `state=active`
  → Zombie migrate container holding the lock. Cleanup step should catch these, but if not: `docker ps -a --filter "label=com.docker.compose.service=migrate"` → `docker rm -f <id>`.

### "Orphan container warning on compose up"

```
Found orphan containers ([secondlayer-X-1]) for this project.
```

Means service `X` was removed from compose but the container is still running. Deploy.sh removes known legacy ones (`view-processor`). If you see a NEW orphan:
```bash
docker rm -f secondlayer-X-1
# Then add it to the `docker rm -f` list in deploy.sh so future deploys clean it.
```

### "Deploy failed with `no such service: X`"

Compose files don't define `X` but deploy.sh references it by name. Usually happens on the FIRST deploy after removing a service. Caused by bash buffering the old deploy.sh while git-reset pulls the new one. The exec-reload at the top of deploy.sh prevents this from recurring. If you see it, push any subsequent commit — next deploy will be clean.

### "CI deploy succeeded but something broken"

```bash
ssh app-server
cd /opt/secondlayer/docker
$COMPOSE logs --tail 200 api | grep -i error
$COMPOSE logs --tail 200 worker | grep -i error
# Then restart whatever's unhealthy:
$COMPOSE up -d --force-recreate api
```

### Image-only rollback

Use the manual `Rollback` GitHub workflow. Leave `image_sha` blank to roll back to the previous successful deploy recorded on the host, or pass a full SHA tag explicitly.

Rollback pulls exact images, recreates app/platform services with `--no-build --no-deps`, health-checks them, and refreshes active tenants. It does not run migrations. Treat rollback as unsafe when the previous image is not compatible with already-applied forward migrations.

```bash
# Inspect host-side deploy state.
cat /opt/secondlayer/data/deploy/current
cat /opt/secondlayer/data/deploy/previous
cat /opt/secondlayer/data/deploy/last-success.env

# Replace with the unit name printed by the GitHub rollback job.
systemctl status secondlayer-rollback-<run_id>-<run_attempt>.service
journalctl -u secondlayer-rollback-<run_id>-<run_attempt>.service -f
```

### "Postgres won't start"

Check disk space first:
```bash
df -h /opt/secondlayer/data
```

If disk is full, bitcoind volumes on the node server fill up first (they're isolated). App server data dir should rarely grow fast except from unbounded log tables. Inspect:
```bash
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
      FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 20;"
```

---

## 5. Manual operations cheatsheet

### Recreate one service from the deployed SHA

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
export DEPLOY_IMAGE_OWNER=secondlayer-labs
export DEPLOY_IMAGE_TAG="$(cat /opt/secondlayer/data/deploy/current)"
$COMPOSE pull api
$COMPOSE up -d --no-build --force-recreate api
```

### Run a migration manually (outside deploy)

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
$COMPOSE run --rm migrate
```

### Connect to the DB directly

```bash
docker exec -it secondlayer-postgres-1 psql -U secondlayer -d secondlayer
```

### Tail all services live

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
$COMPOSE logs -f --tail 50
```

### Backup DB before risky operations

```bash
# Use the existing backup script
bash /opt/secondlayer/docker/scripts/backup-postgres.sh
# Backups land under /opt/secondlayer/data/backups/
ls -lh /opt/secondlayer/data/backups/ | tail -5
```

### Scheduled host jobs (crontab -l)

| Time (UTC) | Job | Script |
|---|---|---|
| `*/5 * * * *` | WAL sync to Storage Box | `sync-wal.sh` |
| `0 2 * * *` | Docker image + build cache prune | `prune-docker-images.sh` |
| `0 3 * * *` | Postgres logical backup | `backup-postgres.sh` |
| `0 4 * * 0` | Weekly pg_basebackup (Sun) | `backup-basebackup.sh` |
| `0 5 * * *` | Upload snapshots to Storage Box | `upload-snapshot.sh` |

All output under `/opt/secondlayer/data/backups/*.log`. `prune-docker-images.sh` is safe — dangling images + build-cache cap only, never touches tagged images or volumes.

---

## 6. Dedicated-hosting lifecycle

The shared-tenancy→dedicated cutover is complete. The control plane provisions
per-tenant containers on demand via `sl instance create`.

### Provisioning a tenant

```bash
sl login
sl project create <name>
sl project use <slug>
sl instance create --plan launch   # or grow, scale
```

The CLI session authenticates to the platform API; the API calls the
provisioner which spawns `sl-pg-<slug>`, `sl-api-<slug>`, and
`sl-proc-<slug>` containers on the `sl-tenants` network. Caddy issues a
per-subdomain cert on first request, validated against the provisioner's
`/internal/caddy/ask` endpoint.

### Lifecycle commands

```bash
sl instance info              # current plan + resource usage
sl instance resize --plan grow
sl instance suspend           # stop containers, keep volume
sl instance resume
sl instance keys rotate --service
sl instance delete            # typed-slug confirm
sl instance db                # DATABASE_URL via SSH tunnel to the bastion
```

See [`DEDICATED_HOSTING.md`](./DEDICATED_HOSTING.md) for the container topology,
[`TENANT_BACKUPS.md`](./TENANT_BACKUPS.md) for the backup/restore runbook.

### DNS + TLS prerequisites

- Wildcard A record `*.{BASE_DOMAIN}` → app-server IP.
- `BASE_DOMAIN` + `CADDY_ACME_EMAIL` set in `.env`.
- `PROVISIONER_SECRET`, `PROVISIONER_SOURCE_DB_READONLY_PASSWORD` set in `.env`.

### Control-plane tables (source DB)

- `blocks`, `transactions`, `events`, `index_progress` — indexer, never touched
- `accounts`, `api_keys`, `sessions`, `projects`, `tenants` — control plane
- `provisioning_audit_log` — lifecycle event trail
- `tenant_usage_monthly` — storage measurements for future billing

Subgraph data lives on per-tenant Postgres containers only — no shared
`subgraphs` registry table on the source DB (dropped in migration 0041).

---

## 7. Secrets management

### Rotating `SECONDLAYER_SECRETS_KEY`

**Critical**: DO NOT rotate this without a plan. Every encrypted column (tenant JWT secrets, signer secrets) becomes unreadable.

Safe rotation:
1. Generate new key: `openssl rand -hex 32`
2. Write a one-off script that reads encrypted columns with old key, re-encrypts with new key, writes back.
3. Deploy with new env var.

### Rotating DB password

```bash
# 1. Generate new password, update .env
# 2. Update Postgres:
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "ALTER ROLE secondlayer WITH PASSWORD '<new>';"
# 3. Restart all app services so they pick up the new DATABASE_URL
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
$COMPOSE up -d --force-recreate api indexer worker agent
```

### Rotating provisioner secret

Zero-downtime:
1. Platform API reads `PROVISIONER_SECRET` from env at each call (not cached)
2. Update `.env`, restart api + worker + provisioner simultaneously: `$COMPOSE --profile platform up -d --force-recreate api worker provisioner`

---

## 8. Phase 2: Streams bulk + dataset publishers

The indexer service runs two in-process loops that export canonical chain data to the public R2 bucket as parquet, then update a JSON manifest. Consumers read `manifest/latest.json` to discover which files exist, sync the parquet they want, and then tail `/v1/streams/events` from `latest_finalized_cursor`.

### What runs where

- **Streams bulk publisher** — `packages/indexer/src/streams-bulk/scheduler.ts`. Exports raw L1 events.
- **STX transfers publisher** — `packages/indexer/src/datasets/stx-transfers/scheduler.ts`. Exports the dataset-shaped STX transfer rows.

Both loops are **forward-only**: each tick computes the latest complete 10,000-block range that's at least 144 blocks behind tip, HEAD-probes R2, and exports + uploads only if the parquet doesn't already exist. They never reach back to fill gaps. Genesis seeding is a separate operator job (see "Genesis backfill" below).

### Env vars (already set in prod)

On `/opt/secondlayer/docker/.env`:

```bash
# Indexer
STREAMS_BULK_PUBLISHER_ENABLED=true
STX_TRANSFERS_PUBLISHER_ENABLED=true
STREAMS_BULK_R2_ENDPOINT=...
STREAMS_BULK_R2_ACCESS_KEY_ID=...
STREAMS_BULK_R2_SECRET_ACCESS_KEY=...
STREAMS_BULK_R2_BUCKET=...
STREAMS_BULK_PREFIX=stacks-streams/mainnet/v0
STREAMS_BULK_NETWORK=mainnet
STREAMS_BULK_RANGE_SIZE_BLOCKS=10000
STREAMS_BULK_FINALITY_LAG_BLOCKS=144

# API (for the proxied public manifest + freshness signals)
STREAMS_BULK_PUBLIC_BASE_URL=https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-streams/mainnet/v0
DATASETS_PUBLIC_BASE_URL=https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-datasets/mainnet/v0
```

The compose env wiring lives in `docker/docker-compose.yml` under `api.environment` and `indexer.environment`.

### Verifying state

Indexer health (both publishers reported):

```bash
ssh app-server "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:\$PATH && docker exec secondlayer-indexer-1 wget -qO- http://localhost:3700/health" | jq .streamsBulkPublisher,.stxTransfersPublisher
```

Public manifest:

```bash
curl -s https://api.secondlayer.tools/public/streams/dumps/manifest | jq '.coverage,.latest_finalized_cursor,.files | length'
```

Public freshness signal:

```bash
curl -s https://api.secondlayer.tools/public/status | jq '.streams.dumps,.datasets'
```

`lag_blocks` is the gap between current chain tip and the last published range. In steady state, expect 10K-30K blocks (one publish cycle is ~28 hours).

### Genesis backfill

The publishers fill forward from whatever the bucket already has. To populate the historical range (block 0 → first forward-published range), run a one-shot CLI per range. **This is optional** — only do it when a customer wants the full archive in parquet form, or when a Foundation grant artifact needs "Stacks chain available as a public DuckDB-readable archive."

Cost picture:
- ~786 ranges of 10K blocks each (genesis to ~7.86M blocks).
- ~5-30s per range depending on row density.
- Total ~6 hours of indexer-side query/export/upload, sequential.
- R2 storage: ~3-5 GB total per dataset.

Run on the indexer host:

```bash
# Streams bulk dumps — historical range
docker exec secondlayer-indexer-1 bun run packages/indexer/src/streams-bulk/export.ts \
  --from-block 0 --to-block 9999 --upload

# STX transfers dataset — historical range
docker exec secondlayer-indexer-1 bun run packages/indexer/src/datasets/stx-transfers/export.ts \
  --from-block 0 --to-block 9999 --upload
```

Iterate `--from-block`/`--to-block` over each 10K range. The exports are idempotent — re-running an already-published range fails by default (use `--force` only for staging recovery, never prod).

A simple wrapper to backfill a contiguous span:

```bash
for start in $(seq 0 10000 7859999); do
  end=$((start + 9999))
  docker exec secondlayer-indexer-1 bun run packages/indexer/src/streams-bulk/export.ts \
    --from-block $start --to-block $end --upload
done
```

The forward loop runs alongside backfill without conflict (different ranges). Watch `/health` between runs — `streamsBulkPublisher.publishedTotal` should keep ticking.

### Disabling the publishers

If R2 outages or cost concerns require pausing exports, set either flag to `false` in `.env` and recreate the indexer:

```bash
ssh app-server
cd /opt/secondlayer/docker
sed -i 's/^STREAMS_BULK_PUBLISHER_ENABLED=.*/STREAMS_BULK_PUBLISHER_ENABLED=false/' .env
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
$COMPOSE up -d --force-recreate indexer
```

The forward-only design means the bucket coverage simply stops advancing. When you re-enable, the loop catches up automatically (publishes any ranges that became eligible while disabled).

---

## 9. Quick reference: what's running on the app server

- `secondlayer-postgres-1` (control-plane DB — accounts, projects, tenants registry)
- `secondlayer-api-1` (platform API, `INSTANCE_MODE=platform`)
- `secondlayer-indexer-1` (blocks/txs/events ingestion → source DB)
- `secondlayer-worker-1` (tenant health cron + storage usage tracking)
- `secondlayer-provisioner-1` (tenant container lifecycle)
- `secondlayer-agent-1` (AI ops monitoring)
- `secondlayer-caddy-1` (TLS proxy, wildcard on-demand certs for `{slug}.secondlayer.tools`)
- `secondlayer-bastion` (SSH tunnel entrypoint for tenant DB access)

**Per-tenant (dynamic)**:
- `sl-pg-{slug}`, `sl-api-{slug}`, `sl-proc-{slug}` — provisioned on `sl instance create`

**On the node server**:
- `bitcoind`
- `stacks-node`
- `event-proxy` (nginx → indexer)

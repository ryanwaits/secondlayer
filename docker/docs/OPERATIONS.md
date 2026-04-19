# Operations Runbook

Living checklist for operating the production stack as we roll out dedicated hosting. Covers env vars you need to set, commands to verify state, and what's coming in upcoming sprints.

Last updated: Sprint 5 (control plane landed, provisioner service code-ready but not started).

---

## 1. Current prod env vars

All on `/opt/secondlayer/docker/.env` on the app server. After editing, run:

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
$COMPOSE up -d --force-recreate api indexer worker subgraph-processor agent
```

### Required (set already, don't break)

| Var | Used by | Purpose |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres, all services | DB auth |
| `SECONDLAYER_SECRETS_KEY` | api, worker, workflow-runner (deprecated) | 32-byte hex — AES-GCM envelope key for encrypted DB columns (tenant JWT secrets, future). Rotate = re-encrypt every row + swap env. Do NOT lose this value — encrypted columns become unreadable. |
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
| `PROVISIONER_IMAGE_TAG` | `latest` | GHCR tag for tenant container images. |
| `PROVISIONER_IMAGE_OWNER` | `secondlayer-labs` | GHCR owner. |
| `PROVISIONER_TENANT_BASE_DOMAIN` | `secondlayer.tools` | Base domain for `{slug}.{base}` tenant URLs. |
| `PROVISIONER_SOURCE_DB_HOST` | `postgres:5432` | Docker-network hostname for the source DB. Tenant containers connect here. |

**NOT required yet** because the provisioner service is behind `--profile platform` and the current deploy script doesn't start it. The routes `/api/tenants/*` and worker trial/health crons are already deployed but all short-circuit when no tenants exist (zero provisioner calls). Set these before activating the provisioner.

### Upcoming (Sprint 6 — Traefik)

| Var | Purpose |
|---|---|
| `CF_API_TOKEN` | Cloudflare DNS-01 token for Let's Encrypt wildcard cert on `*.secondlayer.tools` |
| `TRAEFIK_ACME_EMAIL` | Let's Encrypt account email |

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
  -c "SELECT slug, plan, status, trial_ends_at, storage_used_mb, storage_limit_mb FROM tenants;"

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
  | grep -v "secondlayer-postgres\|secondlayer-api\|secondlayer-indexer\|secondlayer-worker\|secondlayer-subgraph-processor\|secondlayer-agent\|secondlayer-caddy\|secondlayer-migrate"

# If you see leftovers, force-remove:
docker rm -f <name>
```

---

## 3. Deploy flow (what happens on every push to main)

The SSH-action on GitHub runs `/opt/secondlayer/docker/scripts/deploy.sh`. As of Sprint 5, the script does:

1. **git fetch + reset** (source update)
2. **exec-reload** — re-exec the updated deploy.sh so we don't run old buffered content
3. **build** — `--no-cache` for 6 services
4. **stop lock-holders** — `api`, `subgraph-processor`, `agent`, `worker` (indexer kept running)
5. **force-remove orphan containers** — named-removed services from old deploys
6. **clean zombie migrate containers** — prior `--rm` runs killed by SSH timeout
7. **terminate DB sessions** — every non-self session on the DB, clean slate for DDL
8. **run migrations** — `--rm migrate` with `SET statement_timeout=60s` + `lock_timeout=30s`
9. **diagnostic dump on failure** — `pg_stat_activity` printed if migrate fails
10. **up -d** — restart all app services
11. **health check** — curl api + indexer health endpoints

Typical deploy: 60-90s. If it hangs, it'll fail loud in ≤60s now, not silent-timeout at 5min.

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

Means service `X` was removed from compose but the container is still running. Deploy.sh removes known ones (`view-processor`, `workflow-runner`). If you see a NEW orphan:
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

### Rebuild only one service

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
$COMPOSE build --no-cache api
$COMPOSE up -d --force-recreate api
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

---

## 6. Sprint rollout — what's next and what you need to do

### Sprint 5 (just shipped) — control plane

- **You need to**: Nothing right now. `/api/tenants/*` routes are mounted but nobody calls them. Worker crons run but short-circuit (no tenants exist).
- **What to verify after deploy**: `SELECT * FROM kysely_migration WHERE name = '0039_tenants';` returns one row.

### Sprint 6 — Traefik (code-ready, not deployed)

Code will land alongside existing Caddy; nothing changes in prod until we flip DNS.

- **You'll need to**: 
  1. Create a Cloudflare API token with Zone:DNS:Edit on `secondlayer.tools`
  2. Add `CF_API_TOKEN` + `TRAEFIK_ACME_EMAIL` to `.env`
  3. Add wildcard A record `*.secondlayer.tools` → app-server IP (we'll coordinate the exact timing)
- **Deploy impact**: zero. Traefik runs on test ports (8080/8443) alongside Caddy until we cut over.

### Sprint 7 — Dashboard + CLI for dedicated hosting

- **You'll need to**: Set `PROVISIONER_SECRET` + `PROVISIONER_SOURCE_DB_READONLY_PASSWORD` in `.env`.
- **Activating provisioner**: Update `deploy.sh` to include `--profile platform` in the compose commands, or manually:
  ```bash
  $COMPOSE --profile platform up -d provisioner
  ```
- Provisioner health: `curl http://localhost:3850/health` returns `{ok: true, version}`.

### Sprint 8 — Migration from shared to per-tenant DBs (code-ready)

The `packages/provisioner/src/migrate-tenant.ts` script is ready to run. It:
1. Lists your subgraphs from the platform DB
2. Provisions a tenant (via the provisioner service — must be running)
3. `pg_dump` each subgraph schema from source → `pg_restore` to tenant
4. Renames schemas in the tenant DB to drop the account prefix
5. Copies subgraph registry rows into the tenant DB
6. Copies handler `.js` files to the tenant api + processor containers
7. Verifies row counts match source vs tenant

#### Prerequisites (in order)

1. Provisioner must be running (Sprint 7 activation)
2. Traefik SHOULD be running (Sprint 6 activation) so your tenant URL resolves; you can skip if you only care about internal testing first
3. DB backup taken — use `bash /opt/secondlayer/docker/scripts/backup-postgres.sh`
4. Your `SECONDLAYER_SECRETS_KEY` is intact (same key provisioner uses)

#### Dry run first

```bash
ssh app-server
cd /opt/secondlayer

# 1. Find your account ID
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT id, email FROM accounts;"

# 2. Dry run — discovers subgraphs, preflights schemas + handler files, prints plan
export $(cat docker/.env | xargs)
bun run packages/provisioner/src/migrate-tenant.ts \
  --account-id <your-uuid> \
  --plan launch \
  --dry-run
```

Expected output:
```
📋 Found N subgraphs for account:
   - my-subgraph-1 (schema: subgraph_aabbccdd_my_subgraph_1, status: active, blocks: 12345)
   - ...
🔍 Preflight checks...
   ✓ my-subgraph-1: schema + handler present
   ...
✨ Dry-run complete. Rerun without --dry-run to execute.
```

#### Real run

```bash
bun run packages/provisioner/src/migrate-tenant.ts \
  --account-id <your-uuid> \
  --plan launch
```

Typical duration: 30-90s per subgraph (pg_dump speed + table sizes). Script exits non-zero on any step failure; source is never modified unless you pass `--drop-source-schemas`.

#### What gets dropped (source DB) — only with explicit flag

By default: source schemas preserved. The script prints copy-pasteable DROP statements at the end so you can run them manually after verifying the tenant's been stable for a few days.

To drop immediately at migration time:
```bash
bun run packages/provisioner/src/migrate-tenant.ts \
  --account-id <your-uuid> \
  --plan launch \
  --drop-source-schemas
```

#### What stays (source DB) — always

- `blocks`, `transactions`, `events`, `index_progress` — the indexer DB, never touched
- `accounts`, `api_keys`, `sessions`, `projects`, `marketplace_*` — control plane tables
- `tenants` (populated by the migration itself) — control plane mapping
- `subgraphs` registry row for the migrated account — kept for backward-compat until Phase B cleanup (see `POST_MIGRATION_CLEANUP.md`)

#### Post-migration steps

```bash
# 1. Get your service key from the dashboard (/instance page) or tenants table
# 2. Point your CLI at the new instance:
sl instance connect https://<slug>.secondlayer.tools --key sl_svc_...

# 3. Verify: list subgraphs from the tenant
sl subgraphs list
# Should show the same subgraphs as before

# 4. Watch the tenant processor for a few blocks
docker logs sl-proc-<slug> --follow

# 5. Once stable for a few days, drop source schemas (printed at end of migration)
```

See `docker/docs/POST_MIGRATION_CLEANUP.md` for the full Phase A/B/C cleanup plan after all accounts have migrated.

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
$COMPOSE up -d --force-recreate api indexer worker subgraph-processor agent
```

### Rotating provisioner secret (Sprint 7+)

Zero-downtime:
1. Platform API reads `PROVISIONER_SECRET` from env at each call (not cached)
2. Update `.env`, restart api + worker + provisioner simultaneously: `$COMPOSE --profile platform up -d --force-recreate api worker provisioner`

---

## 8. What I need from you at each sprint

| Sprint | Action required |
|---|---|
| 5 (now) | None — already deployed, zero-impact. |
| 6 | Generate Cloudflare API token. Add wildcard DNS A record at the right time (I'll flag). |
| 7 | Generate 2 secrets (`openssl rand -hex 32` for `PROVISIONER_SECRET`, hex 24 for readonly DB password). Add to `.env`. |
| 8 | Schedule a backup + 30min maintenance window for the data migration. |

---

## Quick reference: what's running RIGHT NOW (Sprint 5)

**On the app server**:
- `secondlayer-postgres-1` (shared DB)
- `secondlayer-api-1` (platform API, `INSTANCE_MODE=platform`)
- `secondlayer-indexer-1` (blocks/txs/events ingestion)
- `secondlayer-worker-1` (storage cron + tenant trial/health crons — latter short-circuit with 0 tenants)
- `secondlayer-subgraph-processor-1` (processes blocks into subgraph schemas)
- `secondlayer-agent-1` (AI ops monitoring)
- `secondlayer-caddy-1` (TLS proxy)

**Code-ready but NOT running**:
- `secondlayer-provisioner-1` — awaits Sprint 7 activation (`--profile platform`)
- Traefik — awaits Sprint 6

**On the node server**:
- `bitcoind`
- `stacks-node`
- `event-proxy` (nginx → indexer)

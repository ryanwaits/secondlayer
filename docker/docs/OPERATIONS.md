# Operations Guide

Day-to-day commands for managing a Second Layer deployment. Run from `/opt/secondlayer/docker`.

## Quick Reference

```bash
# Hetzner alias — use this for ALL compose commands
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
```

> **WARNING**: Always use both compose files on Hetzner. Never run plain `docker compose up` — it creates a fresh named volume instead of using the bind-mounted data at `/opt/secondlayer/data/postgres`, effectively hiding your database.
>
> ```bash
> # CORRECT:
> $COMPOSE up -d --build
>
> # WRONG — will create empty volume, lose access to data:
> docker compose up -d --build
> ```

---

## Logs

```bash
# All services
$COMPOSE logs --tail 50

# Single service (api, indexer, worker, stacks-node, postgres, caddy)
$COMPOSE logs indexer --tail 50
$COMPOSE logs stacks-node --tail 50

# Follow in real time
$COMPOSE logs -f worker

# Since a specific time
$COMPOSE logs --since 30m indexer

# Watch stacks-node logs
$COMPOSE logs -f stacks-node
```

---

## Service Status & Health

```bash
# All services + health
$COMPOSE ps

# Resource usage per container
docker stats --no-stream

# Indexer health + block progress
curl -s http://localhost:3700/health | jq
curl -s http://localhost:3700/health/integrity | jq

# API health
curl -s http://localhost:3800/health | jq

# API status (queue depth, block tip, gaps)
curl -s http://localhost:3800/status | jq

# Stacks node sync progress
curl -s http://localhost:20443/v2/info | jq '{burn_block_height, stacks_tip_height, stacks_tip}'

# PoX / reward cycle
curl -s http://localhost:20443/v2/pox | jq '{current_cycle, reward_cycle_length, current_burnchain_block_height}'

# Peer connectivity
curl -s http://localhost:20443/v2/neighbors | jq '{inbound: (.inbound | length), outbound: (.outbound | length)}'

# Compare node vs indexer tip
echo "node:" && curl -s localhost:20443/v2/info | jq .stacks_tip_height && \
echo "indexer:" && curl -s localhost:3700/health | jq .lastSeenHeight

# Continuous monitoring
watch -n 30 'curl -s localhost:20443/v2/info | jq "{stacks_tip_height, burn_block_height}" && curl -s localhost:3700/health | jq "{indexer_tip: .lastSeenHeight}"'
```

### Check for Missing Blocks

```bash
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT count(*) as total_blocks FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT min(height), max(height) FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT (max(height) - min(height) + 1) - count(*) as missing FROM blocks WHERE canonical = true;"
```

### Service Health

```bash
# API
curl -s localhost:3800/health | jq .

# Indexer
curl -s localhost:3700/health | jq .

# Postgres connections & DB size
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT count(*) as active_connections FROM pg_stat_activity;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT pg_size_pretty(pg_database_size('secondlayer')) as db_size;"

# Check event dispatcher (should return empty when healthy)
docker logs --tail 50 secondlayer-stacks-node-1 2>&1 | grep "event_dispatcher"
```

---

## Restart Services

```bash
# Single service
$COMPOSE restart worker
$COMPOSE restart indexer
$COMPOSE restart stacks-node

# Restart everything
$COMPOSE restart

# Full stop + start (recreates containers)
$COMPOSE down && $COMPOSE up -d
```

---

## Update / Upgrade

### Full Stack Update (with rebuild)

```bash
cd /opt/secondlayer
git pull
cd docker
$COMPOSE down
$COMPOSE up -d --build
```

### Individual Service Updates

```bash
# API only
$COMPOSE up -d --build api

# Indexer only
$COMPOSE up -d --build indexer

# Worker only (can scale at same time)
$COMPOSE up -d --build --scale worker=3 worker

# View processor only
$COMPOSE up -d --build view-processor

# Stacks node only (pulls latest image)
$COMPOSE pull stacks-node && $COMPOSE up -d stacks-node
```

> **Note**: Keep the stacks-node compose image version aligned with Hiro archive snapshot versions when restoring from snapshots.

### Quick Update (config/env only, no rebuild)

```bash
$COMPOSE up -d --force-recreate api
```

### Zero-Downtime Updates

```bash
# Scale up first, then scale back down
$COMPOSE up -d --scale worker=4 --no-recreate
$COMPOSE up -d --build worker
$COMPOSE up -d --scale worker=2
```

### Apply Config Changes

After editing `docker/.env` or `docker-compose.yml`:

```bash
# Recreate affected containers
$COMPOSE up -d

# Or force recreate all
$COMPOSE up -d --force-recreate
```

### Verify After Update

```bash
$COMPOSE ps
$COMPOSE logs --tail 20
curl -s http://localhost:3800/health | jq
curl -s http://localhost:3700/health | jq
```

### Platform-Specific Upgrade

**Hetzner:**
```bash
cd /opt/secondlayer && git pull
cd docker
$COMPOSE up -d --build
```

**Docker Compose (non-Hetzner):**
```bash
git pull
docker compose build
docker compose up -d
```

**Render:** Push to connected branch. Render auto-deploys. Migrations run on API startup.

---

## Scaling Workers

Workers can be horizontally scaled. Each worker claims jobs using PostgreSQL's `SKIP LOCKED` to prevent duplicates.

```bash
# Hetzner
$COMPOSE up -d --scale worker=3

# Docker Compose (non-Hetzner)
docker compose up -d --scale worker=3
```

Render: Deploy multiple worker instances.

---

## Database

```bash
# Connect to psql
docker exec -it secondlayer-postgres-1 psql -U secondlayer -d secondlayer

# Check block count
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT COUNT(*) FROM blocks;"

# Quick backup
docker exec secondlayer-postgres-1 pg_dump -U secondlayer secondlayer > backup-$(date +%F).sql
```

---

## Backups

### Automated Cron Setup

```bash
# Add to root crontab
crontab -e

# Postgres backup — daily at 3am
0 3 * * * /opt/secondlayer/docker/scripts/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1

# Chainstate backup (LVM snapshot) — daily at 4am
0 4 * * * /opt/secondlayer/docker/scripts/backup-chainstate.sh >> /var/log/backup-chainstate.log 2>&1
```

### Manual pg_dump / Restore

```bash
# Dump
docker exec secondlayer-postgres-1 pg_dump -U secondlayer secondlayer > backup-$(date +%F).sql

# Restore
cat backup.sql | docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer
```

### PostgreSQL Tuning for Fast Restore

Temporarily adjust settings during large restores:

```sql
-- Before restore
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET max_wal_size = '64GB';
ALTER SYSTEM SET checkpoint_timeout = '3600';
ALTER SYSTEM SET autovacuum = off;
SELECT pg_reload_conf();

-- After restore
ALTER SYSTEM RESET maintenance_work_mem;
ALTER SYSTEM RESET max_wal_size;
ALTER SYSTEM RESET checkpoint_timeout;
ALTER SYSTEM SET autovacuum = on;
SELECT pg_reload_conf();
VACUUM ANALYZE;
```

---

## Disk Usage

```bash
# Overall disk
df -h /opt/secondlayer

# Per-directory breakdown
du -sh /opt/secondlayer/data/postgres
du -sh /opt/secondlayer/data/stacks-blockchain
du -sh /mnt/chainstate  # if using separate mount

# Docker volumes
docker system df
```

---

## Monitoring

Key metrics to monitor:

| Metric | How |
|--------|-----|
| Queue depth | `GET /status` → pending job count |
| Delivery success rate | Track `failedDeliveries` in stream metrics |
| Indexer lag | Compare `lastIndexedBlock` to chain tip |
| Block integrity | `GET /status` → `integrity`, `gaps`, `totalMissingBlocks` |
| Integrity health | `GET /health/integrity` on indexer |
| Out-of-order blocks | `GET /health` and `GET /status` include counter |

---

## Troubleshooting

### Indexer Not Receiving Blocks

1. Check Stacks node logs for event observer errors
2. Verify network connectivity between node and indexer
3. Ensure `events_keys = ["*"]` in `Config.toml`

### Node Stuck on "missing PoX anchor block"

Symptom: logs loop with `Currently missing PoX anchor block` and `Burnchain block processing stops`.

1. Upgrade to latest stacks-node version ([releases](https://github.com/stacks-network/stacks-core/releases))
2. Restart: `$COMPOSE restart stacks-node`

### Event Dispatcher Stuck ("Failed to send socket data")

Symptom: `Event dispatcher: connection or request failed to indexer:3700` repeating.

1. Stop stacks-node
2. Delete pending payloads DB: `rm /opt/secondlayer/data/stacks-blockchain/event_observers.sqlite`
3. Restart stacks-node
4. Check for block gaps (see "Check for Missing Blocks" above)

### Webhooks Not Delivering

1. Check `streams logs <stream-id>` for delivery errors
2. Verify webhook URL is reachable from worker
3. Check for signature verification failures

### High Queue Depth

1. Scale up workers
2. Check for slow webhook endpoints (increase timeout or optimize)
3. Check worker logs for errors

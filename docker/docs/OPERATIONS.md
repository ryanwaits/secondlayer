# Operations Guide

Day-to-day commands for managing a Second Layer deployment. Run from `/opt/secondlayer/docker`.

```bash
# Hetzner alias — use for ALL compose commands
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
```

> **WARNING**: Always use both compose files on Hetzner. Plain `docker compose up` creates a fresh named volume instead of using bind-mounted data at `/opt/secondlayer/data/postgres`.

---

## Logs

```bash
$COMPOSE logs --tail 50               # All services
$COMPOSE logs -f indexer               # Follow indexer
$COMPOSE logs --since 30m stacks-node  # Last 30 min
```

---

## Health & Status

```bash
# Service status
$COMPOSE ps
docker stats --no-stream

# Indexer
curl -s localhost:3700/health | jq
curl -s localhost:3700/health/integrity | jq

# API
curl -s localhost:3800/health | jq
curl -s localhost:3800/status | jq

# Stacks node
curl -s localhost:20443/v2/info | jq '{burn_block_height, stacks_tip_height}'

# Compare node vs indexer tip
echo "node:" && curl -s localhost:20443/v2/info | jq .stacks_tip_height && \
echo "indexer:" && curl -s localhost:3700/health | jq .lastSeenHeight

# DB stats
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT COUNT(*) FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT MIN(height), MAX(height) FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c \
  "SELECT (MAX(height)-MIN(height)+1)-COUNT(*) AS missing FROM blocks WHERE canonical=true;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c \
  "SELECT pg_size_pretty(pg_database_size('secondlayer'));"
```

---

## Restart & Update

```bash
# Restart single service
$COMPOSE restart indexer

# Full rebuild + deploy
cd /opt/secondlayer && git pull
cd docker && $COMPOSE up -d --build

# Single service rebuild
$COMPOSE up -d --build indexer

# Config/env change only (no rebuild)
$COMPOSE up -d --force-recreate indexer

# Scale workers
$COMPOSE up -d --scale worker=3
```

---

## Tip Follower

The tip follower polls Hiro's public API when the stacks-node stops sending blocks (e.g. node restart, network issues). It only fetches a small window near the chain tip — bulk gaps are handled by the integrity auto-backfill.

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `TIP_FOLLOWER_ENABLED` | `true` | Set `false` during genesis sync |
| `TIP_FOLLOWER_TIMEOUT` | `60` | Seconds of silence before switching to polling |
| `TIP_FOLLOWER_MAX_BLOCKS` | `10` | Max blocks to fetch per cycle |
| `TIP_FOLLOWER_INTERVAL` | `10` | Check interval in seconds |

### Manage

```bash
# Disable (during genesis sync or debugging)
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d --force-recreate indexer

# Re-enable (after sync catches up)
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer

# Check status in logs
$COMPOSE logs indexer | grep -i "tip follower"
```

### Behavior

- **Normal mode**: Node pushes blocks via event observer. Tip follower is idle.
- **Polling mode**: After `TIMEOUT` seconds of silence, polls Hiro for chain tip and fetches up to `MAX_BLOCKS` near the tip.
- **Auto-recovery**: When the node pushes a block, tip follower switches back to normal.

---

## Genesis Sync

Full chain sync from block 0 via the stacks-node event observer.

### Start Fresh

```bash
# 1. Stop everything
$COMPOSE down

# 2. Delete chainstate (forces re-sync from genesis)
rm -rf /mnt/chainstate/mainnet

# 3. Truncate indexer DB
$COMPOSE up -d postgres
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "TRUNCATE blocks, transactions, events, jobs, deliveries, index_progress CASCADE;"

# 4. Start services with tip follower disabled
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d

# 5. Monitor progress
$COMPOSE logs -f stacks-node   # Bitcoin header sync first, then Stacks blocks
$COMPOSE logs -f indexer        # Block indexing progress
```

### Timeline

1. **Bitcoin headers** (~30min): Node downloads all Bitcoin headers
2. **Stacks blocks** (~4-7 days): Node processes each Stacks block from genesis, pushes to indexer via event observer
3. **Catch up**: When indexer tip matches chain tip, re-enable tip follower

### After Sync Completes

```bash
# Verify all blocks indexed with real raw_tx
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT COUNT(*) FROM transactions WHERE raw_tx = '0x00';"
# Should be 0

# Re-enable tip follower
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer
```

---

## Integrity & Auto-Backfill

The indexer runs an integrity loop every 5 minutes:

1. Scans for gaps in the `blocks` table
2. For each gap: tries **local DB** first (for reprocessing), then **Hiro remote API** as fallback
3. Posts missing blocks to the indexer's `/new_block` endpoint

```bash
# Check integrity
curl -s localhost:3700/health/integrity | jq

# Check gaps in DB
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT * FROM index_progress;"
```

---

## Database

```bash
# Connect to psql
docker exec -it secondlayer-postgres-1 psql -U secondlayer -d secondlayer

# Quick backup
docker exec secondlayer-postgres-1 pg_dump -U secondlayer secondlayer > backup-$(date +%F).sql

# Restore
cat backup.sql | docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer
```

### Backups (Automated)

```bash
# Recommended cron schedule
0 3 * * * /opt/secondlayer/docker/scripts/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1
0 4 * * * /opt/secondlayer/docker/scripts/backup-chainstate.sh >> /var/log/backup-chainstate.log 2>&1
0 5 * * * /opt/secondlayer/docker/scripts/upload-snapshot.sh >> /var/log/upload-snapshot.log 2>&1
```

### Offsite (Storage Box)

```bash
/opt/secondlayer/docker/scripts/upload-snapshot.sh
/opt/secondlayer/docker/scripts/upload-snapshot.sh --dry-run
ssh -p 23 $STORAGEBOX_USER@$STORAGEBOX_HOST ls -lh /backups/postgres/
```

### Restore

```bash
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --verify-only
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --dry-run
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh
```

### Tuning for Large Restores

```sql
-- Before
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET max_wal_size = '64GB';
ALTER SYSTEM SET autovacuum = off;
SELECT pg_reload_conf();

-- After
ALTER SYSTEM RESET ALL;
SELECT pg_reload_conf();
VACUUM ANALYZE;
```

---

## Disk Usage

```bash
df -h /opt/secondlayer
du -sh /opt/secondlayer/data/postgres
du -sh /mnt/chainstate
docker system df
```

---

## Bulk Backfill (Reprocessing)

For reprocessing existing data or filling large gaps using Hiro's remote API:

```bash
docker run -d --name backfill \
  --network secondlayer_default \
  -v /opt/secondlayer:/app -w /app \
  -e DATABASE_URL=postgres://secondlayer:secondlayer@postgres:5432/secondlayer \
  -e HIRO_API_URL=https://api.mainnet.hiro.so \
  -e HIRO_API_KEY=${HIRO_API_KEY:-} \
  -e BACKFILL_SOURCE=hiro \
  -e BACKFILL_CONCURRENCY=20 \
  -e BACKFILL_BATCH_SIZE=100 \
  -e BACKFILL_FROM=2 \
  oven/bun:latest bun run packages/indexer/src/bulk-backfill.ts

# For reprocessing from own DB (e.g. after schema changes)
-e BACKFILL_SOURCE=local
```

> Block 1 (genesis) has 330K events. Set `BACKFILL_FROM=2` to skip it.

---

## Troubleshooting

### Indexer Not Receiving Blocks

1. Check stacks-node logs for event observer errors
2. Verify `events_keys = ["*"]` in `Config.toml`
3. Check `disable_retries = true` — missed blocks won't be retried by the node
4. Integrity auto-backfill will fill gaps from Hiro

### Node Stuck on "missing PoX anchor block"

Upgrade to latest stacks-node version. Restart: `$COMPOSE restart stacks-node`

### Event Dispatcher Stuck

```bash
$COMPOSE stop stacks-node
rm /opt/secondlayer/data/stacks-blockchain/event_observers.sqlite
$COMPOSE start stacks-node
```

### High Queue Depth

Scale workers: `$COMPOSE up -d --scale worker=3`

---

## Agent (AI DevOps)

Monitors services, auto-fixes safe issues, alerts via Slack.

```bash
curl -s localhost:3900/health | jq
$COMPOSE logs -f agent

# Disable AI
AGENT_AI_ENABLED=false $COMPOSE up -d agent

# Dry run mode
AGENT_DRY_RUN=true $COMPOSE up -d agent
```

See [agent Slack setup](OPERATIONS.md#slack-app-setup) in the previous version for full Slack integration details.

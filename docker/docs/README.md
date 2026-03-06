# Infrastructure

## Architecture

Two-server setup:

| Server | Hardware | SSH | Services |
|--------|----------|-----|----------|
| App server | AX52 | `ssh app-server` | indexer, API, Postgres, Caddy, worker, agent |
| Node server | AX162-S | `ssh node-server` | bitcoind, stacks-node |

The node server pushes Stacks block events to the app server indexer on port 3700.

---

## Quick Reference

```bash
# App server — run from /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# Node server — run from /opt/secondlayer/docker/node-server
NODE_COMPOSE="docker compose"
```

> Always use both compose files on app server. Plain `docker compose` creates a fresh named volume instead of using the bind-mounted data at `/opt/secondlayer/data/postgres`.

---

## Initial Setup

### App Server

```bash
ssh app-server
git clone <repo> /opt/secondlayer
cd /opt/secondlayer/docker
bash scripts/bootstrap.sh
```

`bootstrap.sh` phases:
1. Provisions Docker, UFW (22/80/443), fail2ban, systemd service
2. Pre-flight: checks `.env`, disk space (>200GB required)
3. Starts: postgres → migrate → api, indexer, worker, view-processor
4. Starts caddy

Flags:
```bash
bash scripts/bootstrap.sh --skip-provision   # skip OS provisioning
bash scripts/bootstrap.sh --data-dir /path   # override DATA_DIR
```

After provisioning node server, open firewall:
```bash
ufw allow from <node-server-ip> to any port 3700
```

### Node Server

```bash
ssh node-server
git clone <repo> /opt/secondlayer
bash /opt/secondlayer/docker/node-server/setup.sh
# prompts for app server IP
```

`setup.sh`:
- Installs Docker, UFW, fail2ban
- Formats `/dev/nvme0n1` → `/data/bitcoin`, `/dev/nvme1n1` → `/data/stacks`
- Generates `bitcoin.conf`, `Config.toml`, `.env`
- Installs systemd service
- Starts bitcoind (IBD begins immediately)

**Important:** `bitcoin.conf` must be copied into `$BITCOIN_DATA_DIR` before starting bitcoind. The image chowns the data dir to UID 1000 on startup:
```bash
cp bitcoin.conf $BITCOIN_DATA_DIR/
chown -R 1000:1000 $BITCOIN_DATA_DIR
```

---

## Genesis Sync

Full chain sync from block 0. Takes ~4-10 days total.

### Steps

**1. Bitcoin IBD** (~1-3 days)

```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
$NODE_COMPOSE up -d bitcoind
# Monitor
docker exec secondlayer-node-server-bitcoind-1 bitcoin-cli \
  -rpcuser=stacks -rpcpassword=<pw> getblockchaininfo
```

bitcoind must pass block **666050** before stacks-node can start.

**2. Start stacks-node** (after Bitcoin passes 666050)

```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
$NODE_COMPOSE up -d stacks-node
```

**3. Start app server with tip follower disabled**

```bash
ssh app-server
cd /opt/secondlayer/docker
# Truncate DB if starting fresh
$COMPOSE up -d postgres
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "TRUNCATE blocks, transactions, events, jobs, deliveries, index_progress CASCADE;"
# Start with tip follower off
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d
```

**4. Stacks sync** (~3-7 days)

```bash
ssh node-server && $NODE_COMPOSE logs -f stacks-node
ssh app-server  && $COMPOSE logs -f indexer
```

**5. After sync completes**

```bash
# Verify no placeholder transactions
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT COUNT(*) FROM transactions WHERE raw_tx = '0x00';"
# Should be 0

# Re-enable tip follower
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer
```

### Re-sync from genesis

```bash
# Node server: wipe stacks chainstate
ssh node-server "rm -rf /home/stacks/mainnet"
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose restart stacks-node"
```

---

## Daily Operations

### Logs

```bash
# App server
$COMPOSE logs --tail 50
$COMPOSE logs -f indexer

# Node server
ssh node-server
$NODE_COMPOSE logs -f stacks-node
$NODE_COMPOSE logs --since 30m bitcoind
```

### Health Checks

```bash
# App server services
$COMPOSE ps
docker stats --no-stream

# Indexer
curl -s localhost:3700/health | jq
curl -s localhost:3700/health/integrity | jq

# API
curl -s localhost:3800/health | jq
curl -s localhost:3800/status | jq

# Stacks node tip (run from node server)
ssh node-server "curl -s localhost:20443/v2/info | jq '{burn_block_height, stacks_tip_height}'"

# Compare node vs indexer tip
echo "node:" && ssh node-server "curl -s localhost:20443/v2/info | jq .stacks_tip_height"
echo "indexer:" && curl -s localhost:3700/health | jq .lastSeenHeight

# DB stats
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "SELECT MIN(height), MAX(height), COUNT(*) FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "SELECT (MAX(height)-MIN(height)+1)-COUNT(*) AS missing FROM blocks WHERE canonical=true;"
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "SELECT pg_size_pretty(pg_database_size('secondlayer'));"

# Node server
ssh node-server
$NODE_COMPOSE ps
docker exec secondlayer-node-server-bitcoind-1 bitcoin-cli \
  -rpcuser=stacks -rpcpassword=<pw> getblockchaininfo
```

### Disk Usage

```bash
# App server
df -h /opt/secondlayer
du -sh /opt/secondlayer/data/postgres
docker system df

# Node server
ssh node-server "df -h /home && du -sh /home/bitcoin /home/stacks"
```

### Restart & Update

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

# Node server: update stacks-node
ssh node-server
cd /opt/secondlayer/docker/node-server
# Edit docker-compose.yml image tag, then:
$NODE_COMPOSE pull stacks-node && $NODE_COMPOSE up -d stacks-node

# Node server: full restart
$NODE_COMPOSE down && $NODE_COMPOSE up -d
```

---

## Tip Follower

Polls Hiro's public API when stacks-node stops sending blocks (node restart, network issues). Only fetches a small window near chain tip — bulk gaps handled by integrity auto-backfill.

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `TIP_FOLLOWER_ENABLED` | `true` | Set `false` during genesis sync |
| `TIP_FOLLOWER_TIMEOUT` | `60` | Seconds of silence before polling |
| `TIP_FOLLOWER_MAX_BLOCKS` | `10` | Max blocks per cycle |
| `TIP_FOLLOWER_INTERVAL` | `10` | Check interval (seconds) |

### Manage

```bash
# Disable
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d --force-recreate indexer

# Re-enable
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer

# Check status
$COMPOSE logs indexer | grep -i "tip follower"
```

---

## Database

### Connect & Inspect

```bash
docker exec -it secondlayer-postgres-1 psql -U secondlayer -d secondlayer

# Check gaps
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT * FROM index_progress;"
```

### Backup

```bash
# Manual
docker exec secondlayer-postgres-1 pg_dump -U secondlayer secondlayer > backup-$(date +%F).sql

# Automated cron (app server)
0 3 * * * /opt/secondlayer/docker/scripts/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1
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
# From local dump
cat backup.sql | docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer

# From snapshot
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --verify-only
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --dry-run
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh
```

### Tuning for Large Restores

```sql
-- Before restore
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET max_wal_size = '64GB';
ALTER SYSTEM SET autovacuum = off;
SELECT pg_reload_conf();

-- After restore
ALTER SYSTEM RESET ALL;
SELECT pg_reload_conf();
VACUUM ANALYZE;
```

---

## Backfill

### Auto (Integrity Loop)

Runs every 5 minutes. Scans for gaps, fills from local DB first, then Hiro remote API.

```bash
curl -s localhost:3700/health/integrity | jq
```

### Bulk Backfill (Manual)

For large-scale population or reprocessing after schema changes:

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
```

> Block 1 (genesis) has 330K events. Always set `BACKFILL_FROM=2`.

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_SOURCE` | `hiro` | `hiro` = Hiro API, `local` = own Postgres |
| `BACKFILL_FROM` | `2` | Start height |
| `BACKFILL_TO` | auto | End height (auto-detects chain tip) |
| `BACKFILL_CONCURRENCY` | `20` | Parallel fetches |
| `BACKFILL_BATCH_SIZE` | `100` | Blocks per DB batch |

```bash
# Monitor
docker logs backfill 2>&1 | grep "Batch complete" | tail -5

# Stop
docker stop backfill && docker rm backfill
```

### Chainstate Snapshot (optional)

Bootstrap stacks-node from Hiro's archive (~800-900 GB) instead of syncing from scratch. Note: still need a backfill strategy for the indexer DB.

```bash
# Stream to disk
wget -qO- https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz \
  | tar xzf - -C /data/stacks

# With resume support
curl --continue-at - -L -o /tmp/snapshot.tar.gz \
  https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz
tar -xzf /tmp/snapshot.tar.gz -C /data/stacks
rm /tmp/snapshot.tar.gz
```

---

## Troubleshooting

### Indexer not receiving blocks

1. Check stacks-node logs on node server for event observer errors
2. Verify `events_keys = ["*"]` in `Config.toml`
3. Check firewall: app server port 3700 must be open from node server IP
4. `disable_retries = true` — missed blocks won't be retried by node; integrity loop fills gaps

```bash
ssh node-server && ufw status
ssh app-server  && ufw status   # must have node-server IP → 3700
```

### Node stuck on "missing PoX anchor block"

Upgrade stacks-node image tag, then:
```bash
ssh node-server
$NODE_COMPOSE pull stacks-node && $NODE_COMPOSE up -d stacks-node
```

### Event dispatcher stuck

```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose stop stacks-node
rm /home/stacks/event_observers.sqlite
docker compose start stacks-node
```

### High queue depth

```bash
$COMPOSE up -d --scale worker=3
```

### "Unknown payload type: N"

Rebuild indexer with latest `@secondlayer/stacks` package:
```bash
$COMPOSE up -d --build indexer
```

---

## Monitoring (Agent)

AI agent monitors services, auto-fixes safe issues, alerts via Slack.

```bash
curl -s localhost:3900/health | jq
$COMPOSE logs -f agent

# Disable AI actions
AGENT_AI_ENABLED=false $COMPOSE up -d --force-recreate agent

# Dry run (no mutations)
AGENT_DRY_RUN=true $COMPOSE up -d --force-recreate agent
```

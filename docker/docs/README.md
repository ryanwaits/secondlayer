# Infrastructure

## Architecture

Two-server setup:

| Server | Hardware | SSH | Services |
|--------|----------|-----|----------|
| App server | AX52 | `ssh app-server` | indexer, API, Postgres, Caddy, worker, agent |
| Node server | AX162-S | `ssh node-server` | bitcoind, stacks-node |

The node server pushes Stacks block events to the app server indexer on port 3700. App server runs `postgres:17-alpine`.

---

## Quick Reference

```bash
# App server — run from /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# Node server — run from /opt/secondlayer/docker/node-server
# Just use: docker compose
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
3. Starts: postgres → migrate → api, indexer, worker, subgraph-processor
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
- Installs Docker, UFW, fail2ban, jq
- Formats `/dev/nvme0n1` → `/data/bitcoin`, `/dev/nvme1n1` → `/data/stacks`
- Generates `bitcoin.conf`, `Config.toml`, `.env` with random RPC password
- Installs systemd service (`secondlayer-node`)
- Starts bitcoind (IBD begins immediately)

> **Gotcha:** `STACKS_DATA_DIR` in `.env` (default `/data/stacks`) must match where chainstate actually lives on disk. If using a snapshot restore, extract to the path in `.env` — a mismatch causes full re-sync from genesis.

**Note:** `bitcoin.conf` must be copied into `$BITCOIN_DATA_DIR` before starting, and the data dir must be owned by UID 1000:
```bash
cp bitcoin.conf $BITCOIN_DATA_DIR/
chown -R 1000:1000 $BITCOIN_DATA_DIR
```

---

## Genesis Sync

Full chain sync from block 0. Takes ~10-14 days total. **All steps are manual** — stacks-node does not auto-start.

### Steps

**1. Start bitcoind** — IBD begins immediately

```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose up -d bitcoind
```

Monitor progress (~1-3 days to reach block 666050):
```bash
ssh node-server
RPC_PW=$(grep BITCOIN_RPC_PASSWORD /opt/secondlayer/docker/node-server/.env | cut -d= -f2)
docker exec secondlayer-bitcoind-1 bitcoin-cli -rpcuser=stacks -rpcpassword=$RPC_PW \
  getblockchaininfo | jq '{blocks,headers,verificationprogress}'
```

**2. Start app server with tip follower disabled** (do this while Bitcoin syncs)

```bash
ssh app-server
cd /opt/secondlayer/docker
# Truncate DB for clean genesis sync
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "TRUNCATE blocks, transactions, events, jobs, deliveries, index_progress CASCADE;"
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d
```

**3. Start stacks-node** — only after bitcoind blocks > 666050

```bash
# Verify Bitcoin is past Stacks genesis burn height
ssh node-server
RPC_PW=$(grep BITCOIN_RPC_PASSWORD /opt/secondlayer/docker/node-server/.env | cut -d= -f2)
docker exec secondlayer-bitcoind-1 bitcoin-cli -rpcuser=stacks -rpcpassword=$RPC_PW getblockcount
# Must be > 666050

cd /opt/secondlayer/docker/node-server
docker compose up -d stacks-node
# Bitcoin and Stacks sync in parallel from here (~3-7 days)
```

Monitor:
```bash
# Node server
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose logs -f stacks-node"

# App server
ssh app-server "cd /opt/secondlayer/docker && \
  $COMPOSE logs -f indexer"
```

**4. After sync completes**

```bash
ssh app-server
cd /opt/secondlayer/docker

# Check for placeholder transactions (excluding burnchain ops which legitimately have raw_tx = '0x00')
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT COUNT(*) FROM transactions WHERE raw_tx = '0x00' AND type_id NOT IN (1,2,3,4,5);"
# Should be 0. ~700 burnchain operations (PoX stacking, STX transfers via BTC) have raw_tx = '0x00' by design.

# Re-enable tip follower
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer
```

### Re-sync from genesis

```bash
# Node server: wipe stacks chainstate (check STACKS_DATA_DIR in .env)
ssh node-server "source /opt/secondlayer/docker/node-server/.env && rm -rf \${STACKS_DATA_DIR}/mainnet \${STACKS_DATA_DIR}/event_observers.sqlite"
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose stop stacks-node && docker compose start stacks-node"

# App server: truncate DB
ssh app-server "docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c 'TRUNCATE blocks, transactions, events, jobs, deliveries, index_progress CASCADE;'"
```

---

## Daily Operations

### Logs

```bash
# App server
$COMPOSE logs --tail 50
$COMPOSE logs -f indexer

# Node server
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose logs -f stacks-node"
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose logs --since 30m bitcoind"
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

# Bitcoin sync (node server)
ssh node-server
RPC_PW=$(grep BITCOIN_RPC_PASSWORD /opt/secondlayer/docker/node-server/.env | cut -d= -f2)
docker exec secondlayer-bitcoind-1 bitcoin-cli -rpcuser=stacks -rpcpassword=$RPC_PW \
  getblockchaininfo | jq '{blocks,headers,verificationprogress}'
```

### Contracts

```bash
# Total indexed contracts
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT count(*) FROM contracts;"

# Top contracts by call count
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT name, contract_id, call_count FROM contracts ORDER BY call_count DESC LIMIT 10;"

# ABI cache stats
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT count(*) FILTER (WHERE abi IS NOT NULL) AS cached, count(*) AS total FROM contracts;"

# Test API endpoint
curl -s -H "Authorization: Bearer $TOKEN" "https://api.secondlayer.tools/api/contracts?q=bns" | jq
```

### Disk Usage

```bash
# App server
df -h /opt/secondlayer
du -sh /opt/secondlayer/data/postgres
docker system df

# Node server
ssh node-server "df -h /data && du -sh /data/bitcoin /data/stacks"
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

# Node server: update stacks-node (edit docker-compose.yml image tag first)
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose pull stacks-node && docker compose up -d stacks-node

# Node server: full restart
docker compose down && docker compose up -d
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
# Source credentials from .env
source /opt/secondlayer/docker/.env

docker run -d --name backfill \
  --no-healthcheck \
  --network secondlayer_default \
  -v /opt/secondlayer:/app -w /app \
  -e DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB} \
  -e HIRO_API_URL=https://api.mainnet.hiro.so \
  -e HIRO_API_KEY=${HIRO_API_KEY:-} \
  -e BACKFILL_SOURCE=hiro \
  -e BACKFILL_CONCURRENCY=20 \
  -e BACKFILL_BATCH_SIZE=100 \
  -e BACKFILL_FROM=2 \
  oven/bun:latest bun run packages/indexer/src/bulk-backfill.ts

# Fastest option: backfill from local Hiro Postgres (~24-40 blocks/sec with batch queries)
docker run -d --name backfill \
  --no-healthcheck \
  --network secondlayer_default \
  -v /opt/secondlayer:/app -w /app \
  -e DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB} \
  -e HIRO_PG_URL=postgres://secondlayer:secondlayer@postgres:5432/stacks_blockchain_api?options=-csearch_path%3Dstacks_blockchain_api \
  -e BACKFILL_SOURCE=hiro-pg \
  -e BACKFILL_CONCURRENCY=20 \
  -e BACKFILL_BATCH_SIZE=100 \
  -e BACKFILL_FROM=2 \
  oven/bun:latest bun run packages/indexer/src/bulk-backfill.ts
```

> `hiro-pg` is the fastest backfill source (~24-40 blocks/sec with batch queries). Requires a local copy of the Hiro API database — see "Hiro PG Restore" below.

> Block 1 (genesis) has 330K events. Always set `BACKFILL_FROM=2`.

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_SOURCE` | `hiro` | `hiro` = Hiro API, `local` = own Postgres, `hiro-pg` = direct PG queries against local Hiro API database (fastest, ~24-40 blocks/sec with batch queries) |
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

### Hiro PG Restore

Restore Hiro's API Postgres dump locally for fast `hiro-pg` backfill.

```bash
# 1. Download dump from archive.hiro.so
curl -L -o /tmp/hiro-api-pg.dump \
  https://archive.hiro.so/mainnet/stacks-blockchain-api/mainnet-stacks-blockchain-api-latest.dump

# 2. Create database in existing Postgres container
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "CREATE DATABASE stacks_blockchain_api;"

# 3. Restore (parallel with --jobs 4)
docker exec -i secondlayer-postgres-1 \
  pg_restore -U secondlayer -d stacks_blockchain_api --no-owner --jobs 4 \
  < /tmp/hiro-api-pg.dump

# 4. Run backfill with hiro-pg source
#    Connection string must set search_path via options param:
#    postgres://user:pass@host:5432/stacks_blockchain_api?options=-csearch_path%3Dstacks_blockchain_api
#    See bulk backfill commands above.

# 5. Drop database after parity verification
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "DROP DATABASE stacks_blockchain_api;"
rm /tmp/hiro-api-pg.dump
```

> Apply the "Tuning for Large Restores" settings (see Database section) before pg_restore — massive speedup.

### Chainstate Snapshot (optional)

Bootstrap stacks-node from Hiro's archive (~800-900 GB) instead of syncing from scratch. Note: still need a backfill strategy for the indexer DB.

```bash
ssh node-server

# 1. Download archive to /tmp (resumable)
curl --continue-at - -L -o /tmp/snapshot.tar.zst \
  https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.zst

# 2. Stop stacks-node
cd /opt/secondlayer/docker/node-server
docker compose stop stacks-node

# 3. Extract to STACKS_DATA_DIR (check .env — default /data/stacks)
source .env
tar --zstd -xf /tmp/snapshot.tar.zst -C ${STACKS_DATA_DIR:-/data/stacks}

# 4. Start stacks-node — first boot does sortDB migration (normal, takes a few minutes)
docker compose start stacks-node

# 5. Clean up after verifying node is syncing
rm /tmp/snapshot.tar.zst
```

> **CRITICAL:** `STACKS_DATA_DIR` in `/opt/secondlayer/docker/node-server/.env` must match the extraction path. A mismatch causes stacks-node to find an empty data dir and re-sync from genesis.
>
> First boot after snapshot restore runs a sortDB migration — this is normal and takes a few minutes. Do not kill the process.

---

## Troubleshooting

### Indexer not receiving blocks

1. Check stacks-node logs on node server for event observer errors
2. Verify `events_keys = ["*"]` in node server `Config.toml`
3. Check firewall: app server port 3700 must be open from node server IP
4. `disable_retries = true` — missed blocks won't be retried by node; integrity loop fills gaps

```bash
ssh node-server "ufw status"
ssh app-server "ufw status"   # must have node-server IP → 3700
```

### Node stuck on "missing PoX anchor block"

Upgrade stacks-node image tag in `docker-compose.yml`, then:
```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose pull stacks-node && docker compose up -d stacks-node
```

### Event dispatcher stuck

```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose stop stacks-node
rm /data/stacks/event_observers.sqlite
docker compose start stacks-node
```

### DNS resolution failure (Ubuntu 24.04)

Containers can't resolve external hosts. Ubuntu's systemd-resolved binds 127.0.0.53 which fails inside Docker. Setup scripts configure `/etc/docker/daemon.json` automatically. Manual fix:

```bash
echo '{"dns":["8.8.8.8","1.1.1.1"]}' > /etc/docker/daemon.json
systemctl restart docker
docker run --rm alpine nslookup google.com  # verify
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

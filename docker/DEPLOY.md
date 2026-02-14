# Hetzner AX52 Deployment

## Quick Start (Automated)

```bash
cd /opt/secondlayer/docker
cp .env.hetzner.example .env
# Edit .env with your values

bash scripts/bootstrap.sh
```

`bootstrap.sh` handles everything: starts services, downloads + restores Hiro archive, fixes schema gotchas, runs bulk backfill (detached, without raw_tx for speed), and starts stacks-node. PG trust auth for hiro-postgres is baked into the compose config.

Options:
- `--skip-backfill` — skip the bulk backfill phase
- `--data-dir /path` — override DATA_DIR from .env

After backfill completes, run the raw_tx pass: `bash docker/scripts/backfill-raw-tx.sh`

### Two-Pass Backfill Strategy

1. **Fast pass** (bootstrap.sh default): `BACKFILL_INCLUDE_RAW_TX=false` — indexes blocks/txs/events at 200-500 blocks/sec
2. **raw_tx pass** (manual after): fills in raw transaction hex, ~40x slower but non-blocking

Env vars for raw_tx pass:

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_RAW_TX_CONCURRENCY` | 10 | Parallel API fetches |
| `BACKFILL_RAW_TX_BATCH_SIZE` | 500 | Txids per iteration |

Monitor: `docker logs backfill-raw-tx --tail 10`
Verify: `SELECT COUNT(*) FROM transactions WHERE raw_tx = '0x00';` — should decrease toward 0

## Manual Start

```bash
# On server
cd /opt/secondlayer/docker
cp .env.hetzner.example .env
# Edit .env with your values

docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d
```

## Storage Configuration

Data paths are configurable via `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/opt/secondlayer/data` | Base data directory |
| `CHAINSTATE_DIR` | `$DATA_DIR/stacks-blockchain` | Stacks blockchain data |

Example `.env`:
```bash
DATA_DIR=/opt/secondlayer/data
CHAINSTATE_DIR=/mnt/chainstate  # Optional: separate mount for blockchain
```

## Storage Requirements

| Component | Size |
|-----------|------|
| Stacks blockchain (mainnet, fully synced) | 800-900 GB |
| PostgreSQL | ~50 GB |
| Views cache | ~10 GB |

The AX52 default RAID6 config (~887 GB) is tight for a fully synced node.

---

## Chainstate Storage (LVM Stripe)

The AX52 has 4 NVMe drives in RAID6, but the two 1TB Samsung drives each only use ~477GB for RAID partitions, leaving ~477GB free per drive. We use LVM to stripe this free space into a single ~938GB volume for chainstate.

**Current drive layout:**

| Drive | Model | Size | RAID usage | Free |
|-------|-------|------|------------|------|
| nvme0n1 | Toshiba 512GB | 477GB | All used | 0 |
| nvme1n1 | Toshiba 512GB | 477GB | All used | 0 |
| nvme2n1 | Samsung 1TB | 954GB | 477GB | **477GB** |
| nvme3n1 | Samsung 1TB | 954GB | 477GB | **477GB** |

**LVM config:**
- PVs: `/dev/nvme2n1p4`, `/dev/nvme3n1p4`
- VG: `chainstate-vg`
- LV: `chainstate` (striped across both, ~938GB)
- Mounted at `/mnt/chainstate`

No redundancy for chainstate — if either Samsung fails, chainstate is lost. This is acceptable since it can be restored from [Hiro's archive snapshot](#using-a-snapshot).

### Setup (already done)

```bash
# Create p4 partitions on free space of Samsung drives
parted /dev/nvme2n1 mkpart primary 512GB 100%
parted /dev/nvme3n1 mkpart primary 512GB 100%

# LVM: stripe across both drives
pvcreate /dev/nvme2n1p4 /dev/nvme3n1p4
vgcreate chainstate-vg /dev/nvme2n1p4 /dev/nvme3n1p4
lvcreate -l 100%FREE -n chainstate -i 2 chainstate-vg

# Format, mount, persist
mkfs.ext4 /dev/chainstate-vg/chainstate
mkdir -p /mnt/chainstate
mount /dev/chainstate-vg/chainstate /mnt/chainstate
echo '/dev/chainstate-vg/chainstate /mnt/chainstate ext4 defaults 0 2' >> /etc/fstab

# Point secondlayer at the new volume
echo 'CHAINSTATE_DIR=/mnt/chainstate' >> /opt/secondlayer/docker/.env
```

### Future: Hetzner drive swap

The AX52 is at max drive count. Hetzner can replace a 512GB Toshiba with a 2TB NVMe (~30min downtime). This would allow partitioning the 2TB for RAID rebuild (~477GB) + ~1.5TB standalone chainstate, eliminating the need for LVM striping. Contact Hetzner via Robot → Support to schedule.

---

## Monitoring

```bash
# Sync progress
curl -s localhost:20443/v2/info | jq '{stacks_tip_height, burn_block_height}'

# Indexer tip (should match stacks_tip_height)
curl -s localhost:3700/health | jq .

# Compare node vs indexer
echo "node:" && curl -s localhost:20443/v2/info | jq .stacks_tip_height && echo "indexer:" && curl -s localhost:3700/health | jq .lastSeenHeight

# PoX / reward cycle status
curl -s localhost:20443/v2/pox | jq '{current_cycle, reward_cycle_length, current_burnchain_block_height}'

# Peer connectivity
curl -s localhost:20443/v2/neighbors | jq '{inbound: (.inbound | length), outbound: (.outbound | length)}'

# All services
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml ps

# Storage usage
df -h
du -sh /opt/secondlayer/data/*
du -sh /mnt/chainstate  # if using separate mount

# Resource usage per container
docker stats --no-stream

# Watch logs
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml logs -f stacks-node
```

### Check for missing blocks

```bash
docker exec docker-postgres-1 psql -U secondlayer -c "SELECT count(*) as total_blocks FROM blocks;"
docker exec docker-postgres-1 psql -U secondlayer -c "SELECT min(height), max(height) FROM blocks;"
docker exec docker-postgres-1 psql -U secondlayer -c "SELECT (max(height) - min(height) + 1) - count(*) as missing FROM blocks WHERE canonical = true;"
```

### Continuous monitoring

```bash
# Watch sync in real-time
watch -n 30 'curl -s localhost:20443/v2/info | jq "{stacks_tip_height, burn_block_height}" && curl -s localhost:3700/health | jq "{indexer_tip: .lastSeenHeight}"'
```

### Service health

```bash
# API
curl -s localhost:3800/health | jq .

# Indexer
curl -s localhost:3700/health | jq .

# Postgres connections & DB size
docker exec docker-postgres-1 psql -U secondlayer -c "SELECT count(*) as active_connections FROM pg_stat_activity;"
docker exec docker-postgres-1 psql -U secondlayer -c "SELECT pg_size_pretty(pg_database_size('secondlayer')) as db_size;"

# Check event dispatcher (should return empty when healthy)
docker logs --tail 50 docker-stacks-node-1 2>&1 | grep "event_dispatcher"
```

## Troubleshooting

### Node stuck on "missing PoX anchor block"

Symptom: logs loop with `Currently missing PoX anchor block` and `Burnchain block processing stops`.

1. Upgrade to latest stacks-node version (check [releases](https://github.com/stacks-network/stacks-core/releases))
2. Restart: `docker compose -f docker-compose.yml -f docker-compose.hetzner.yml restart stacks-node`

### Event dispatcher stuck ("Failed to send socket data")

Symptom: `Event dispatcher: connection or request failed to indexer:3700` repeating, node won't process blocks.

1. Stop stacks-node
2. Delete pending payloads DB: `rm /opt/secondlayer/data/stacks-blockchain/event_observers.sqlite`
3. Restart stacks-node
4. Check for block gaps in postgres (see "Check for missing blocks" above)

### Restart services

```bash
cd /opt/secondlayer/docker

# Single service
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml restart stacks-node

# All services
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml down && docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d
```

## Bulk Backfill (Self-Hosted Hiro API)

The stacks-node syncs from genesis at ~1 block/sec (~90 days to chain tip). To fill the indexer DB immediately, self-host a Hiro API from their PG archive dump and backfill from localhost with no rate limits.

### 1. Start Hiro Postgres

```bash
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d hiro-postgres
```

### 2. Download Archive

```bash
bash docker/scripts/download-hiro-archive.sh
# ~60GB, supports resume if interrupted
```

### 3. Restore PG Dump

Copy dump into the container (required for parallel restore), then restore:

```bash
docker cp /opt/secondlayer/data/hiro-pg-dump/hiro-api.dump docker-hiro-postgres-1:/tmp/hiro-api.dump

docker exec docker-hiro-postgres-1 pg_restore \
  --username postgres --dbname stacks_blockchain_api \
  --jobs 4 --no-owner --no-privileges \
  /tmp/hiro-api.dump
```

This takes 1-3 hours. Monitor progress:

```bash
# DB size (should grow to ~120-150GB)
docker exec docker-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
  -c "SELECT pg_size_pretty(pg_database_size('stacks_blockchain_api'));"
```

### 4. Fix Schema Location

The archive restores into a `stacks_blockchain_api` schema instead of `public`. Move it:

```bash
docker exec docker-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
  -c "ALTER SCHEMA stacks_blockchain_api RENAME TO public_old; ALTER SCHEMA public RENAME TO public_empty; ALTER SCHEMA public_old RENAME TO public;"
```

Verify:

```bash
docker exec docker-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
  -c "SELECT MAX(block_height) FROM blocks;"
```

### 5. Clean Up Dump Files

```bash
rm /opt/secondlayer/data/hiro-pg-dump/hiro-api.dump
docker exec docker-hiro-postgres-1 rm -f /tmp/hiro-api.dump
```

### 6. Start Hiro API

```bash
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d hiro-api
```

Verify (from inside docker network — hiro-api binds to 127.0.0.1 inside container):

```bash
docker exec docker-hiro-api-1 node -e \
  "fetch('http://127.0.0.1:3999/extended/v1/status').then(r=>r.json()).then(d=>console.log(d.status, d.chain_tip.block_height))"
```

### 7. Configure Indexer

Add to `.env`:

```bash
HIRO_API_URL=http://hiro-api:3999
HIRO_FALLBACK_URL=https://api.mainnet.hiro.so
HIRO_API_KEY=              # optional, for better rate limits on public fallback
BACKFILL_INCLUDE_RAW_TX=true
```

Restart indexer to pick up new env:

```bash
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d indexer
```

### 8. Run Bulk Backfill

Run detached so it survives SSH disconnects:

```bash
docker run -d --name backfill \
  --network docker_default \
  -v /opt/secondlayer:/app -w /app \
  -e HIRO_API_URL=http://hiro-api:3999 \
  -e HIRO_FALLBACK_URL=https://api.mainnet.hiro.so \
  -e DATABASE_URL=postgres://USER:PASS@postgres:5432/secondlayer \
  -e BACKFILL_INCLUDE_RAW_TX=true \
  -e BACKFILL_CONCURRENCY=20 \
  -e BACKFILL_BATCH_SIZE=100 \
  -e BACKFILL_FROM=2 \
  oven/bun:latest bun run packages/indexer/src/bulk-backfill.ts
```

> **Note:** Start from block 2 (`BACKFILL_FROM=2`) — block 1 (genesis) has 330K events that take hours to paginate through the API. Handle genesis separately or let the integrity loop fill it later.

### Backfill Management

```bash
# Check progress
docker logs backfill 2>&1 | grep "Batch complete" | tail -5

# Check for failures
docker logs backfill 2>&1 | grep "Batch insert failed" | tail -10

# DB block count
docker exec docker-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT MIN(height), MAX(height), COUNT(*) FROM blocks;"

# Stop backfill
docker stop backfill && docker rm backfill

# Restart backfill (skips already-indexed blocks automatically)
docker run -d --name backfill ...  # same command as above
```

### Expected Performance

| Metric | Value |
|--------|-------|
| Throughput | 200-500 blocks/sec |
| ETA for 6.5M blocks | 4-9 hours |
| Hiro PG disk usage | ~120-150 GB |

### After Backfill

The hiro-postgres + hiro-api stay running for ongoing gap-fill. The indexer's integrity loop runs every 5 min, detects missing blocks, and fills them from the local Hiro API (falling back to public API for blocks beyond the snapshot).

```bash
# Verify gap count
docker exec docker-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT (MAX(height) - MIN(height) + 1) - COUNT(*) AS missing FROM blocks WHERE canonical = true;"

# Check contiguous tip
docker exec docker-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT * FROM index_progress;"
```

### Troubleshooting

**"Batch insert failed: invalid byte sequence for encoding UTF8: 0x00"**
- Fixed in code — null bytes stripped before DB insert. If running old code, pull latest and restart.
- Failed batches are skipped and retried on next backfill run.

**"Failed to decode raw_tx: Unknown payload type"**
- Cosmetic warning. Our SDK can't parse some old/unusual Stacks tx types. The raw_tx hex is still stored correctly.

**Backfill stuck on genesis block**
- Block 1 has 330K events (STX allocations). Set `BACKFILL_FROM=2` to skip.

**Hiro API unreachable from host**
- Hiro API binds to `127.0.0.1` inside container. Access via docker network only (other containers, or `docker exec`). The backfill runs in a container on `docker_default` network.

---

## Using a Chainstate Snapshot

To bootstrap the stacks-node from Hiro's chainstate archive instead of syncing from scratch:

```bash
# Download (~321 GB compressed)
curl -L -o /tmp/snapshot.tar.gz \
  https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz

# Extract to chainstate dir
tar -xzf /tmp/snapshot.tar.gz -C /mnt/chainstate

# Cleanup
rm /tmp/snapshot.tar.gz
```

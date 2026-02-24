# Backfill & Chainstate Snapshots

How to populate the indexer database with historical blockchain data.

---

## Strategy Overview

Three approaches, from fastest to slowest:

| Strategy | Speed | Requires |
|----------|-------|----------|
| **Hiro API backfill** (self-hosted) | 200-500 blocks/sec | ~200GB disk for Hiro PG |
| **Chainstate snapshot** + node sync | Node syncs from snapshot tip | ~400GB for snapshot |
| **Genesis sync** (stacks-node from block 0) | ~1 block/sec (~90 days) | Patience |

Most deployments use **Hiro API backfill** for the indexer DB + a **chainstate snapshot** for the stacks-node. `bootstrap.sh` automates both.

---

## Two-Pass Backfill

1. **Fast pass** (bootstrap.sh default): `BACKFILL_INCLUDE_RAW_TX=false` — indexes blocks/txs/events at 200-500 blocks/sec
2. **raw_tx pass** (manual after): fills in raw transaction hex, ~40x slower but non-blocking

After fast pass completes:
```bash
bash docker/scripts/backfill-raw-tx.sh
```

Env vars for raw_tx pass:

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_RAW_TX_CONCURRENCY` | 10 | Parallel API fetches |
| `BACKFILL_RAW_TX_BATCH_SIZE` | 500 | Txids per iteration |

Monitor: `docker logs backfill-raw-tx --tail 10`
Verify: `SELECT COUNT(*) FROM transactions WHERE raw_tx = '0x00';` — should decrease toward 0

---

## bootstrap.sh Handles This

```bash
cd /opt/secondlayer/docker
bash scripts/bootstrap.sh
```

The script: starts services, downloads + restores Hiro archive, fixes schema, runs bulk backfill (detached, without raw_tx for speed), and starts stacks-node.

Options:
- `--skip-backfill` — skip the bulk backfill phase
- `--skip-provision` — skip system provisioning (Phase 0)
- `--data-dir /path` — override DATA_DIR from .env

---

## Manual Hiro API Backfill

If not using `bootstrap.sh`, follow these steps to self-host the Hiro API for unlimited local backfill.

### 1. Start Hiro Postgres

```bash
$COMPOSE up -d hiro-postgres
```

### 2. Download Archive

```bash
bash docker/scripts/download-hiro-archive.sh
# ~60GB, supports resume if interrupted
```

### 3. Restore PG Dump

Copy dump into the container (required for parallel restore):

```bash
docker cp /opt/secondlayer/data/hiro-pg-dump/hiro-api.dump secondlayer-hiro-postgres-1:/tmp/hiro-api.dump

docker exec secondlayer-hiro-postgres-1 pg_restore \
  --username postgres --dbname stacks_blockchain_api \
  --jobs 4 --no-owner --no-privileges \
  /tmp/hiro-api.dump
```

Takes 1-3 hours. Monitor:

```bash
docker exec secondlayer-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
  -c "SELECT pg_size_pretty(pg_database_size('stacks_blockchain_api'));"
```

### 4. Fix Schema Location

The archive restores into a `stacks_blockchain_api` schema instead of `public`:

```bash
docker exec secondlayer-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
  -c "ALTER SCHEMA stacks_blockchain_api RENAME TO public_old; ALTER SCHEMA public RENAME TO public_empty; ALTER SCHEMA public_old RENAME TO public;"
```

Verify:
```bash
docker exec secondlayer-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
  -c "SELECT MAX(block_height) FROM blocks;"
```

### 5. Clean Up Dump Files

```bash
rm /opt/secondlayer/data/hiro-pg-dump/hiro-api.dump
docker exec secondlayer-hiro-postgres-1 rm -f /tmp/hiro-api.dump
```

### 6. Start Hiro API

```bash
$COMPOSE up -d hiro-api
```

Verify (hiro-api binds to 127.0.0.1 inside container — access via docker network):

```bash
docker exec secondlayer-hiro-api-1 node -e \
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

Restart indexer:
```bash
$COMPOSE up -d indexer
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

> **Note:** Start from block 2 (`BACKFILL_FROM=2`) — block 1 (genesis) has 330K events that take hours to paginate. Handle genesis separately or let the integrity loop fill it later.

---

## Backfill Management

```bash
# Check progress
docker logs backfill 2>&1 | grep "Batch complete" | tail -5

# Check for failures
docker logs backfill 2>&1 | grep "Batch insert failed" | tail -10

# DB block count
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT MIN(height), MAX(height), COUNT(*) FROM blocks;"

# Stop backfill
docker stop backfill && docker rm backfill

# Restart backfill (skips already-indexed blocks automatically)
docker run -d --name backfill ...  # same command as above

# Verify gap count
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT (MAX(height) - MIN(height) + 1) - COUNT(*) AS missing FROM blocks WHERE canonical = true;"

# Check contiguous tip
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT * FROM index_progress;"
```

### Expected Performance

| Metric | Value |
|--------|-------|
| Throughput | 200-500 blocks/sec |
| ETA for 6.5M blocks | 4-9 hours |
| Hiro PG disk usage | ~120-150 GB |

### After Backfill

The hiro-postgres + hiro-api stay running for ongoing gap-fill. The indexer's integrity loop runs every 5 min, detects missing blocks, and fills them from the local Hiro API (falling back to public API for blocks beyond the snapshot).

---

## Chainstate Snapshot Restore

Bootstrap the stacks-node from Hiro's chainstate archive instead of syncing from scratch.

### Available Snapshots

List available snapshots via GCS:
```bash
curl -s 'https://storage.googleapis.com/storage/v1/b/archive.hiro.so/o?prefix=mainnet/stacks-blockchain/&delimiter=/' | jq '.items[].name'
```

### Download & Extract (Streaming)

Stream directly to disk — no intermediate file needed:

```bash
# To default chainstate dir
wget -qO- https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz \
  | tar xzf - -C /opt/secondlayer/data/stacks-blockchain

# To LVM mount (if using separate chainstate volume)
wget -qO- https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz \
  | tar xzf - -C /mnt/chainstate
```

> **Size**: ~321 GB compressed, ~800-900 GB extracted. Ensure your target has enough space. See [HETZNER-HARDWARE.md](HETZNER-HARDWARE.md) for LVM setup.

### Download & Extract (Two-Step)

If you need checksum verification or resume support:

```bash
# Download (~321 GB)
curl --continue-at - -L -o /tmp/snapshot.tar.gz \
  https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz

# Verify checksum
curl -sL https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.sha256 -o /tmp/snapshot.sha256
echo "$(cat /tmp/snapshot.sha256 | awk '{print $1}')  /tmp/snapshot.tar.gz" | sha256sum -c

# Extract
tar -xzf /tmp/snapshot.tar.gz -C /mnt/chainstate

# Cleanup
rm /tmp/snapshot.tar.gz /tmp/snapshot.sha256
```

---

## Troubleshooting

### "Batch insert failed: invalid byte sequence for encoding UTF8: 0x00"
Fixed in code — null bytes stripped before DB insert. If running old code, pull latest and restart. Failed batches are skipped and retried on next run.

### "Failed to decode raw_tx: Unknown payload type"
Cosmetic warning. Our SDK can't parse some old/unusual Stacks tx types. The raw_tx hex is still stored correctly.

### Backfill Stuck on Genesis Block
Block 1 has 330K events (STX allocations). Set `BACKFILL_FROM=2` to skip.

### Hiro API Unreachable from Host
Hiro API binds to `127.0.0.1` inside container. Access via docker network only (other containers, or `docker exec`). The backfill runs in a container on `docker_default` network.

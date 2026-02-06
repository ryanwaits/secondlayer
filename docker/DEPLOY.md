# Hetzner AX52 Deployment

## Quick Start

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

## Using a Snapshot

To bootstrap from Hiro's archive instead of syncing from scratch:

```bash
# Download (~321 GB compressed)
curl -L -o /tmp/snapshot.tar.gz \
  https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz

# Extract to chainstate dir
tar -xzf /tmp/snapshot.tar.gz -C /mnt/chainstate

# Cleanup
rm /tmp/snapshot.tar.gz
```

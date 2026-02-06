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

The AX52 default RAID6 config (~887 GB) is tight for a fully synced node. Consider adding NVMe storage.

---

## Adding NVMe Storage

The AX41-NVMe is a whole server, not an add-on drive. For your existing AX52:

### How to Request Additional NVMe

1. Log into [Hetzner Robot](https://robot.hetzner.com)
2. Go to your server → Support → Request additional hardware
3. Request NVMe upgrade (typically 1TB or 2TB options)
4. They'll schedule installation (brief downtime)

Typical addon pricing is ~€5-15/month for NVMe drives. Check via Robot for exact AX52 options.

**References:**
- [AX Server configurations and add-ons](https://docs.hetzner.com/robot/dedicated-server/server-lines/ax-server/)
- [Price Dedicated Server Addons](https://docs.hetzner.com/robot/dedicated-server/dedicated-server-hardware/price-server-addons/)
- [AX52 Configurator](https://www.hetzner.com/dedicated-rootserver/ax52/configurator/)

### Before Scheduled Maintenance

Hetzner will power off the server to physically install the drive. Stop services gracefully before the maintenance window to prevent data corruption.

```bash
cd /opt/secondlayer/docker

# Stop all services (depends_on ensures correct order: node stops before indexer)
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml down

# Verify everything stopped
docker ps
```

<details>
<summary>Manual ordering (if you want explicit control)</summary>

Stop stacks-node first to ensure indexer doesn't miss any blocks emitted during shutdown:

```bash
# 1. Stop stacks-node first (stops emitting events)
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml stop stacks-node

# 2. Stop remaining services
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml down
```

</details>

The stacks node will resume syncing from where it left off—no progress lost.

### Migration Workflow

After Hetzner installs the new drive:

```bash
# 1. Identify new drive
lsblk

# 2. Format and mount
mkfs.ext4 /dev/nvmeXn1
mkdir -p /mnt/chainstate
mount /dev/nvmeXn1 /mnt/chainstate

# 3. Add to fstab for persistence
echo '/dev/nvmeXn1 /mnt/chainstate ext4 defaults 0 2' >> /etc/fstab

# 4. Stop services and migrate data
cd /opt/secondlayer/docker
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml down
rsync -avP /opt/secondlayer/data/stacks-blockchain/ /mnt/chainstate/

# 5. Update .env to use new path
echo 'CHAINSTATE_DIR=/mnt/chainstate' >> .env

# 6. Restart
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d

# 7. Verify and cleanup old data (optional, after confirming sync works)
# rm -rf /opt/secondlayer/data/stacks-blockchain
```

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

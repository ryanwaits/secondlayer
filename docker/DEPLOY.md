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
# Check sync progress
curl -s http://localhost:20443/v2/info | jq '{stacks_tip_height, burn_block_height}'

# Check storage usage
df -h
du -sh /opt/secondlayer/data/*
du -sh /mnt/chainstate  # if using separate mount

# Watch logs
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml logs -f stacks-node
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

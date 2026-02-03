# Deploying Second Layer

This guide covers deploying Second Layer in production.

## Architecture

Second Layer consists of four components:

| Service | Port | Description |
|---------|------|-------------|
| **API** | 3800 | REST API for views and stream management |
| **Indexer** | 3700 | Receives blocks from Stacks node, stores in DB |
| **Worker** | - | Processes jobs, evaluates filters, delivers webhooks |
| **PostgreSQL** | 5432 | Stores blocks, views, jobs, deliveries |

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│ Stacks Node │ ──── │   Indexer   │ ──── │  PostgreSQL │
└─────────────┘      └─────────────┘      └─────────────┘
                                                 │
┌─────────────┐      ┌─────────────┐             │
│   Your App  │ ◄─── │   Worker    │ ────────────┘
└─────────────┘      └─────────────┘
                           │
┌─────────────┐            │
│     API     │ ───────────┘
└─────────────┘
```

## Environment Variables

All services require:

```bash
DATABASE_URL=postgres://user:password@host:5432/secondlayer
```

Service-specific:

```bash
# API
PORT=3800
LOG_LEVEL=info

# Indexer
PORT=3700
LOG_LEVEL=info
REQUIRE_INTEGRITY=false       # Exit on startup if block gaps detected
AUTO_BACKFILL=false            # Auto-fetch missing blocks from Stacks node
AUTO_BACKFILL_RATE=10          # Blocks/sec rate limit for auto-backfill

# Worker
WORKER_CONCURRENCY=5
NETWORKS=mainnet          # or "mainnet,testnet"
LOG_LEVEL=info
```

---

## Deploy on Render

Render is the recommended platform for deploying Second Layer. You'll create 4 services:

### 1. PostgreSQL Database

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **PostgreSQL**
3. Configure:
   - **Name**: `secondlayer-db`
   - **Database**: `secondlayer`
   - **User**: `secondlayer`
   - **Region**: Choose closest to your Stacks node
   - **Plan**: Starter ($7/mo) or higher
4. Copy the **Internal Database URL** for use in other services

### 2. API Service

1. Click **New** → **Web Service**
2. Connect your GitHub repo
3. Configure:
   - **Name**: `secondlayer-api`
   - **Region**: Same as database
   - **Runtime**: Docker
   - **Dockerfile Path**: `docker/Dockerfile`
   - **Docker Build Context**: `.`
   - **Docker Target**: `api`
4. Environment variables:
   ```
   DATABASE_URL=<internal-database-url>
   PORT=10000
   LOG_LEVEL=info
   ```
5. Health check path: `/health`

### 3. Indexer Service

1. Click **New** → **Web Service**
2. Connect your GitHub repo
3. Configure:
   - **Name**: `secondlayer-indexer`
   - **Region**: Same as database
   - **Runtime**: Docker
   - **Dockerfile Path**: `docker/Dockerfile`
   - **Docker Build Context**: `.`
   - **Docker Target**: `indexer`
4. Environment variables:
   ```
   DATABASE_URL=<internal-database-url>
   PORT=10000
   LOG_LEVEL=info
   ```
5. Health check path: `/health`

**Important**: The indexer needs a public URL for your Stacks node to send events to. Note the `.onrender.com` URL.

### 4. Worker Service

1. Click **New** → **Background Worker**
2. Connect your GitHub repo
3. Configure:
   - **Name**: `secondlayer-worker`
   - **Region**: Same as database
   - **Runtime**: Docker
   - **Dockerfile Path**: `docker/Dockerfile`
   - **Docker Build Context**: `.`
   - **Docker Target**: `worker`
4. Environment variables:
   ```
   DATABASE_URL=<internal-database-url>
   WORKER_CONCURRENCY=5
   NETWORKS=mainnet
   LOG_LEVEL=info
   ```

### 5. Run Migrations

Before first use, run migrations. You can do this via Render Shell or a one-off job:

```bash
bun run packages/shared/src/db/migrate.ts
```

Or create a **Job** in Render that runs on deploy.

### 6. Configure Your Stacks Node

Add to your Stacks node's `Config.toml`:

```toml
[[events_observer]]
endpoint = "secondlayer-indexer.onrender.com"
events_keys = ["*"]
timeout_ms = 300000
```

Restart your Stacks node to apply.

---

## Deploy on Hetzner Dedicated (AX52)

Best option for running a full Stacks node + indexer from genesis. Single server, ~$60/mo.

**Server:** AMD Ryzen 7 7700, 64GB DDR5, 2x 1TB NVMe (RAID0 → 2TB)

### 1. Order Server

1. Create account at [hetzner.com](https://www.hetzner.com)
2. Add SSH key in Robot panel → Key Management
3. Order [AX52](https://www.hetzner.com/dedicated-rootserver/ax52/) with Ubuntu 24.04

### 2. DNS

Add an A record: `api.secondlayer.tools → <server-ip>`

### 3. Run Setup

Interactive wizard:
```bash
bun scripts/deploy.ts   # select "Hetzner Dedicated"
```

Or manual:
```bash
DOMAIN=api.secondlayer.tools ssh root@<server-ip> 'bash -s' < hetzner-setup.sh
```

The setup script:
- Installs Docker, configures NVMe RAID0 at `/mnt/data`
- Sets up UFW (22, 80, 443, 20444) + fail2ban
- Clones repo, generates `.env`, starts all services
- Installs systemd unit for auto-start on reboot

### 4. Verify

```bash
ssh root@<server-ip>
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml ps
curl http://localhost:3700/health
curl https://api.secondlayer.tools/health
docker logs stacks-node --tail 20
```

The Stacks node syncs from genesis. The indexer receives every block from block 0 — no backfill needed.

### Architecture

```
Internet → Caddy (:443) → API (:3800)
Stacks Node → POST /new_block → Indexer (:3700) → Postgres → Worker
```

All services run in Docker Compose on the same host. Caddy handles TLS via Let's Encrypt.

---

## Deploy with Docker Compose

For self-hosted deployments:

### 1. Clone and Configure

```bash
git clone https://github.com/secondlayer-labs/secondlayer.git
cd secondlayer
cp docker/.env.example docker/.env
```

Edit `docker/.env`:

```bash
POSTGRES_USER=secondlayer
POSTGRES_PASSWORD=<secure-password>
POSTGRES_DB=secondlayer

API_PORT=3800
INDEXER_PORT=3700

WORKER_CONCURRENCY=5
NETWORKS=mainnet

LOG_LEVEL=info
```

### 2. Start Services

```bash
cd docker
docker compose up -d
```

This starts PostgreSQL, runs migrations, and launches all services.

### 3. Verify

```bash
# Check services
docker compose ps

# Check API health
curl http://localhost:3800/health

# Check indexer health
curl http://localhost:3700/health
```

### 4. Configure Your Stacks Node

Add to `Config.toml`:

```toml
[[events_observer]]
endpoint = "host.docker.internal:3700"  # or your server IP
events_keys = ["*"]
timeout_ms = 300000
```

---

## Server Management

Common commands for managing a Hetzner/Docker Compose deployment. Run from `/opt/secondlayer/docker`.

```bash
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
```

### Logs

```bash
# All services
$COMPOSE logs --tail 50

# Single service (api, indexer, worker, stacks-node, postgres, caddy)
$COMPOSE logs indexer --tail 50
$COMPOSE logs stacks-node --tail 50

# Follow logs in real time
$COMPOSE logs -f worker

# Since a specific time
$COMPOSE logs --since 30m indexer
```

### Service Status

```bash
# All services + health
$COMPOSE ps

# Indexer health + block progress
curl -s http://localhost:3700/health | jq
curl -s http://localhost:3700/health/integrity | jq

# API health
curl -s http://localhost:3800/health | jq

# API status (queue depth, block tip, gaps)
curl -s http://localhost:3800/status | jq
```

### Restart Services

```bash
# Restart a single service
$COMPOSE restart worker
$COMPOSE restart indexer

# Restart everything
$COMPOSE restart

# Full stop + start (recreates containers)
$COMPOSE down && $COMPOSE up -d
```

### Update Deployment

#### Full Stack Update (with rebuild)

```bash
cd /opt/secondlayer
git pull
cd docker
$COMPOSE down
$COMPOSE up -d --build
```

#### Individual Service Updates

Update a single service without rebuilding others:

```bash
cd /opt/secondlayer/docker

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

#### Quick Update (no rebuild, just restart with new code)

If only config/env changed (no code changes):

```bash
$COMPOSE up -d --force-recreate api
```

#### Zero-Downtime Updates

For critical services, use rolling updates:

```bash
# Scale up first, then scale back down
$COMPOSE up -d --scale worker=4 --no-recreate
$COMPOSE up -d --build worker
$COMPOSE up -d --scale worker=2
```

#### Apply Config Changes

After editing `docker/.env` or `docker-compose.yml`:

```bash
# Just recreate affected containers
$COMPOSE up -d

# Or force recreate all
$COMPOSE up -d --force-recreate
```

#### Verify After Update

```bash
# Check all services healthy
$COMPOSE ps

# Check logs for errors
$COMPOSE logs --tail 20

# Verify endpoints
curl -s http://localhost:3800/health | jq
curl -s http://localhost:3700/health | jq
```

### Stacks Node Sync Progress

```bash
# Check header sync %
$COMPOSE logs stacks-node --tail 5

# Check RPC info (once synced)
curl -s http://localhost:20443/v2/info | jq '{burn_block_height, stacks_tip_height, stacks_tip}'
```

### Database

```bash
# Connect to psql
docker exec -it docker-postgres-1 psql -U secondlayer -d secondlayer

# Check block count
docker exec docker-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT COUNT(*) FROM blocks;"

# Backup
docker exec docker-postgres-1 pg_dump -U secondlayer secondlayer > backup-$(date +%F).sql
```

### Disk Usage

```bash
# Overall disk
df -h /opt/secondlayer

# Per-directory breakdown
du -sh /opt/secondlayer/data/postgres
du -sh /opt/secondlayer/data/stacks-blockchain

# Docker volumes
docker system df
```

### Scaling Workers

```bash
$COMPOSE up -d --scale worker=3
```

---

## Production Considerations

### Scaling Workers

Workers can be horizontally scaled. Each worker claims jobs using PostgreSQL's `SKIP LOCKED` to prevent duplicates.

Docker Compose:
```bash
docker compose up -d --scale worker=3
```

Render: Deploy multiple worker instances.

### Database Sizing

Second Layer stores all blocks and events. Estimate storage:
- ~10 KB per block (compressed)
- ~1 GB per 100,000 blocks
- Mainnet has ~150,000+ blocks (as of 2024)

Recommend starting with 10 GB and monitoring growth.

### Monitoring

Key metrics to monitor:
- **Queue depth**: `GET /status` returns pending job count
- **Delivery success rate**: Track `failedDeliveries` in stream metrics
- **Indexer lag**: Compare `lastIndexedBlock` to chain tip
- **Block integrity**: `GET /status` returns `integrity`, `gaps`, and `totalMissingBlocks`
- **Integrity health**: `GET /health/integrity` on the indexer for dedicated integrity checks
- **Out-of-order blocks**: `GET /health` and `GET /status` include out-of-order block counter

### Backups

PostgreSQL backups are critical. On Render, backups are automatic. For self-hosted:

```bash
pg_dump -U secondlayer secondlayer > backup.sql
```

### Security

1. **Use HTTPS** for all endpoints
2. **Firewall** the indexer to only accept traffic from your Stacks node
3. **Rotate secrets** periodically
4. **Enable webhook signature verification** in your handlers

---

## Migrating from stacks-streams

If you have an existing `/opt/stacks-streams` deployment, follow these steps for a zero-downtime migration:

### 1. Clone New Repo

```bash
ssh root@<server-ip>
git clone https://github.com/secondlayer-labs/secondlayer.git /opt/secondlayer
```

### 2. Copy Environment

```bash
cp /opt/stacks-streams/docker/.env /opt/secondlayer/docker/.env
```

### 3. Symlink Existing Data

Avoid copying hundreds of GB by symlinking:

```bash
ln -s /opt/stacks-streams/data /opt/secondlayer/data
```

### 4. Stop Old Services

```bash
systemctl stop stacks-streams
```

### 5. Update Systemd

```bash
sed -i 's|/opt/stacks-streams|/opt/secondlayer|g' /etc/systemd/system/stacks-streams.service
mv /etc/systemd/system/stacks-streams.service /etc/systemd/system/secondlayer.service
systemctl daemon-reload
systemctl enable secondlayer
```

### 6. Start New Services

```bash
cd /opt/secondlayer/docker
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d
```

### 7. Verify

```bash
curl -s http://localhost:3700/health | jq
curl -s http://localhost:3800/health | jq
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml ps
```

### 8. Cleanup (after confirming stability)

```bash
# Wait a day or two, then:
rm -rf /opt/stacks-streams
```

**Rollback**: If issues occur, stop new services, restore symlink, and restart old systemd service.

---

## Troubleshooting

### Indexer not receiving blocks

1. Check Stacks node logs for event observer errors
2. Verify network connectivity between node and indexer
3. Ensure `events_keys = ["*"]` is set

### Webhooks not delivering

1. Check `streams logs <stream-id>` for delivery errors
2. Verify webhook URL is reachable from worker
3. Check for signature verification failures in your handler

### High queue depth

1. Scale up workers
2. Check for slow webhook endpoints (increase timeout or optimize)
3. Check worker logs for errors

---

## Upgrading

### Docker Compose

```bash
git pull
docker compose build
docker compose up -d
```

### Render

Push to your connected branch. Render auto-deploys.

Migrations run automatically on API startup.

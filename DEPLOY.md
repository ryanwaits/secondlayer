# Deploying Second Layer

This guide covers initial setup and deployment. For day-to-day operations, see [docker/docs/OPERATIONS.md](docker/docs/OPERATIONS.md). For historical data backfill, see [docker/docs/BACKFILL.md](docker/docs/BACKFILL.md).

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
┌─────────────┐      ┌─────────────┐            │
│   Your App  │ ◄─── │   Worker    │ ───────────┘
└─────────────┘      └─────────────┘
                          │
┌─────────────┐           │
│     API     │ ──────────┘
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

**Server:** AMD Ryzen 7 7700, 64GB DDR5, 4x NVMe in RAID6. See [docker/docs/HETZNER-HARDWARE.md](docker/docs/HETZNER-HARDWARE.md) for drive layout and LVM config.

### 1. Order Server

1. Create account at [hetzner.com](https://www.hetzner.com)
2. Add SSH key in Robot panel → Key Management
3. Order [AX52](https://www.hetzner.com/dedicated-rootserver/ax52/) with Ubuntu 24.04

### 2. DNS

Add an A record: `api.secondlayer.tools → <server-ip>`

### 3. Run Setup

```bash
DOMAIN=api.secondlayer.tools ssh root@<server-ip> 'bash -s' < hetzner-setup.sh
```

The setup script clones the repo and runs `bootstrap.sh`, which:
- Installs Docker, configures UFW (22, 80, 443, 20444) + fail2ban
- Clones repo, generates `.env`, starts all services
- Downloads Hiro archive + runs bulk backfill
- Installs systemd unit for auto-start on reboot

### 4. Verify

```bash
ssh root@<server-ip>
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml ps
curl http://localhost:3700/health
curl https://api.secondlayer.tools/health
```

### Architecture

```
Internet → Caddy (:443) → API (:3800)
Stacks Node → POST /new_block → Indexer (:3700) → Postgres → Worker
```

All services run in Docker Compose on the same host. Caddy handles TLS via Let's Encrypt.

→ See [docker/docs/OPERATIONS.md](docker/docs/OPERATIONS.md) for server management
→ See [docker/docs/BACKFILL.md](docker/docs/BACKFILL.md) for historical data backfill

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

## Database Sizing

Second Layer stores all blocks and events. Estimate storage:
- ~10 KB per block (compressed)
- ~1 GB per 100,000 blocks
- Mainnet has ~6.5M+ blocks

Recommend starting with 100 GB and monitoring growth.

---

## Security

1. **Use HTTPS** for all endpoints
2. **Firewall** the indexer to only accept traffic from your Stacks node
3. **Rotate secrets** periodically
4. **Enable webhook signature verification** in your handlers

---

## Migrating from stacks-streams

If you have an existing `/opt/stacks-streams` deployment:

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

**Rollback**: Stop new services, restore symlink, restart old systemd service.

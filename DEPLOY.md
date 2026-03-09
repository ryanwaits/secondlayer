# Deploying Second Layer

For day-to-day operations, see [docker/docs/OPERATIONS.md](docker/docs/OPERATIONS.md).

## Architecture

```
Internet → Caddy (:443) → API (:3800) ← View Processor
                                              │
Stacks Node ──event observer──→ Indexer (:3700) → Postgres → Worker → Webhooks
                                     │                          ↑
                               Tip Follower              Job Queue
                            (Hiro remote fallback)
```

| Service | Port | Description |
|---------|------|-------------|
| **Stacks Node** | 20443/20444 | Full node, pushes blocks via event observer |
| **Indexer** | 3700 | Receives blocks, parses txs/events, stores in DB |
| **API** | 3800 | REST API for streams, views, webhooks |
| **Worker** | — | Processes jobs, evaluates filters, delivers webhooks |
| **View Processor** | — | Computes materialized views |
| **Postgres** | 5432 | Stores blocks, transactions, events, jobs |
| **Caddy** | 80/443 | TLS termination, reverse proxy |
| **Agent** | 3900 | AI DevOps monitoring + Slack alerts |

### Block Data Flow

1. **Stacks Node** syncs the chain and pushes every block to the indexer via `POST /new_block`
2. **Indexer** parses the block payload — decodes raw_tx, extracts events, stores everything in Postgres
3. **Integrity loop** (every 5min) detects gaps and auto-fills from local DB or Hiro remote API
4. **Tip follower** (when enabled) polls Hiro for missed tip blocks if the node goes silent

No self-hosted Hiro API required. The indexer gets complete block data (including real `raw_tx` hex) directly from the stacks-node event observer. Hiro's public API (`api.mainnet.hiro.so`) is used only as a thin fallback for gap-fill.

## Environment Variables

All services require `DATABASE_URL`. Service-specific:

```bash
# Indexer
PORT=3700
TIP_FOLLOWER_ENABLED=true       # Disable during genesis sync
TIP_FOLLOWER_TIMEOUT=60         # Seconds of silence before polling
TIP_FOLLOWER_MAX_BLOCKS=10      # Max blocks to fetch per poll cycle
TIP_FOLLOWER_INTERVAL=10        # Poll check interval (seconds)
HIRO_API_URL=https://api.mainnet.hiro.so
HIRO_API_KEY=                    # Optional, for better rate limits
ENABLE_TX_DECODE_FALLBACK=false  # Hit Hiro API for decode failures
BACKFILL_SOURCE=hiro             # "local" for reprocessing from own DB

# Worker
WORKER_CONCURRENCY=5
NETWORKS=mainnet

# API
PORT=3800
RESEND_API_KEY=                  # For magic link auth emails
STACKS_NODE_RPC_URL=http://...   # Stacks node for ABI fetching (contracts endpoint)
```

---

## Deploy on Hetzner (Recommended)

Single server, ~$60/mo. Runs full stacks-node + all services.

**Server:** AX52 — AMD Ryzen 7 7700, 64GB DDR5, 4x NVMe. See [docker/docs/HETZNER-HARDWARE.md](docker/docs/HETZNER-HARDWARE.md).

### 1. Initial Setup

```bash
DOMAIN=api.secondlayer.tools ssh root@<server-ip> 'bash -s' < hetzner-setup.sh
```

### 2. Configure

```bash
cp docker/.env.hetzner.example docker/.env
# Edit .env with real values
```

### 3. Start Services

```bash
cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# Genesis sync — disable tip follower until caught up
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d

# After sync catches up to chain tip, re-enable
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer
```

### 4. Verify

```bash
curl http://localhost:3700/health | jq
curl https://api.secondlayer.tools/health | jq
```

---

## Deploy with Docker Compose

For self-hosted deployments without a stacks-node:

```bash
git clone https://github.com/ryanwaits/secondlayer.git
cd secondlayer
cp docker/.env.example docker/.env
# Edit .env
cd docker && docker compose up -d
```

Point your external stacks-node's `Config.toml` at the indexer:

```toml
[[events_observer]]
endpoint = "your-server:3700"
events_keys = ["*"]
timeout_ms = 30000
```

---

## Deploy on Render

See individual service setup:

1. **PostgreSQL** — Render managed DB
2. **API** — Web Service, Docker target `api`, port 10000
3. **Indexer** — Web Service, Docker target `indexer`, port 10000
4. **Worker** — Background Worker, Docker target `worker`

All need `DATABASE_URL`. The indexer needs a public URL for event observer.

---

## Database Sizing

- ~10 KB per block (compressed)
- ~1 GB per 100K blocks
- Mainnet ~7M+ blocks = ~70+ GB
- Recommend starting with 100 GB

---

## Contracts Table

The `contracts` table is populated automatically:

- **Backfill**: Migration `0007_contracts` backfills from existing `transactions` table on first run
- **Live**: The indexer upserts contracts on every `smart_contract` deploy and increments `call_count` on every `contract_call`
- **ABI**: Fetched lazily from the Stacks node (`STACKS_NODE_RPC_URL`) on first `/api/contracts/:id/abi` request, then cached in the `abi` column

### Verify

```bash
# Contract count
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT count(*) FROM contracts;"

# Top contracts by usage
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT contract_id, name, call_count FROM contracts ORDER BY call_count DESC LIMIT 10;"

# Contracts with cached ABIs
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT count(*) FILTER (WHERE abi IS NOT NULL) AS cached, count(*) AS total FROM contracts;"
```

### Re-backfill

Safe to run anytime (idempotent):

```sql
INSERT INTO contracts (contract_id, name, deployer, deploy_block, deploy_tx_id, created_at)
SELECT DISTINCT ON (contract_id) contract_id, split_part(contract_id, '.', 2), sender, block_height, tx_id, created_at
FROM transactions WHERE type = 'smart_contract' AND contract_id IS NOT NULL
ORDER BY contract_id, block_height ASC
ON CONFLICT (contract_id) DO NOTHING;
```

---

## Security

1. HTTPS for all endpoints (Caddy handles TLS automatically)
2. Firewall indexer to only accept traffic from your stacks-node
3. Enable webhook signature verification in your handlers
4. Rotate secrets periodically

# Production topology

Two hosts. SSH: `ssh ryan@claude-mini` → `ssh app-server` / `ssh node-server`.
Compose project lives at `/opt/secondlayer/docker` on app-server.

- **app-server** — everything below.
- **node-server** (37.27.171.220) — the stacks-node. Pushes the event-observer
  firehose to `indexer`; also serves RPC (`:20443`) for tx-proof endpoints.

## Containers (all required unless noted)

| Container | Role |
|---|---|
| `secondlayer-postgres-1` | **Chain DB** — blocks, transactions, raw events, `decoded_events`. Bind mount `/opt/secondlayer/data/postgres` (~200GB, genesis→tip). |
| `secondlayer-postgres-platform-1` | **Control-plane DB** (`secondlayer_platform`) — accounts, api_keys, subgraph registry + tenant schemas, x402 ledger/balances, sessions. Bind mount `/opt/secondlayer/data/postgres-platform`. |
| `secondlayer-api-<N>` ×2 | The two API replicas behind Caddy (`api.secondlayer.tools`). `<N>` is Compose's instance counter and **increments every rolling deploy** (e.g. 94/95 → 98/99). Always exactly two; the suffix means nothing. |
| `secondlayer-caddy-1` | Load balancer + TLS in front of the api replicas. |
| `secondlayer-indexer-1` | Chain ingestion (event-observer receiver) + Streams bulk/R2 exports. |
| `secondlayer-l2-decoder-1` | Decodes raw events → `decoded_events` (the Index plane). Backfills via `packages/indexer/src/l2/BACKFILL.md`. |
| `secondlayer-subgraph-processor-1` | Subgraph indexing: catch-up follower + operations runner (deploy/reindex/backfill ops). Sparse reindex + boot-time stranded-reindex sweep live here. |
| `secondlayer-subscription-processor-1/-2` | Webhook delivery plane: leader-elected trigger evaluator + competing-consumer emitters. Replica 2 = failover + throughput. |
| `secondlayer-worker-1` | Crons: metering, ghost sweep, x402 reconciler, subgraph-expiry sweep. |
| `secondlayer-redis-1` | Rate limits, x402 nonce/strike stores. |
| `secondlayer-walg-backup-1` | WAL-G postgres backups (chain DB WAL archiving → `/opt/secondlayer/data/wal_archive`). |
| `secondlayer-agent` | Log watcher → Slack alerts (the thing that pages you). No DB of its own. |
| `secondlayer-migrate-1` | One-shot migration runner, re-run by every deploy. **`Exited (0)` is its healthy state.** |

## Operational rules (each one paid for in incidents)

1. **Deploys go through `docker/scripts/deploy.sh` only.** Its `APP_SERVICES`
   allow-list deliberately never touches postgres.
2. **`COMPOSE_FILE` is pinned in the server `.env`**
   (`docker-compose.yml:docker-compose.hetzner.yml`) so even a raw
   `docker compose` command loads the hetzner overlay. The overlay carries the
   real data bind mounts and postgres tuning (`max_connections=200`,
   `wal_level=replica`, WAL-archive mount); the base file alone declares named
   volumes — running without the overlay once attached an empty volume and
   prod silently served a 1,032-block husk (2026-05-02 and 2026-06-11).
3. **Husk canaries**: both postgres healthchecks fail against a
   freshly-initialized data dir (`CHAIN_MIN_BLOCK` / `PLATFORM_MIN_ACCOUNTS`
   floors in the server `.env`), so dependents refuse to start on an empty DB.
   `scripts/preflight-data.sh` (wired into deploy.sh) additionally refuses to
   deploy against a husk.
4. **Never recreate both postgres containers in one command.** Docker can
   reassign their network IPs swapped; service pools with cached DNS then
   query the wrong database ("database secondlayer_platform does not exist"
   FATALs on the chain DB and vice versa). Stagger recreates, then
   `docker restart` all dependents — including `walg-backup`.
5. **Verify data coverage with `count(*)` + `EXISTS` probes at sample
   heights, never `min`/`max` alone** — a sparse husk produces plausible
   min/max ranges.
6. Per-service `environment:` blocks only pass listed vars — adding a key to
   `.env` does nothing until the compose file forwards it.
7. Subgraph op queue: `SUBGRAPH_OPERATION_CONCURRENCY` (8) total slots;
   `SUBGRAPH_HEAVY_OP_BUDGET` (2) caps concurrently-running broad/non-sparse
   syncs so whale genesis jobs can't hold every slot. Both on the
   subgraph-processor in the hetzner overlay.

## Quick checks

```bash
# Everything up + healthy (expect only migrate as Exited (0))
docker ps -a --format '{{.Names}} {{.Status}}'

# Chain DB is the real cluster, not a husk
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -tAc 'SELECT count(*), max(height) FROM blocks'

# Decoder lags (tens of seconds = at tip)
docker exec secondlayer-l2-decoder-1 curl -s localhost:3710/health | \
  python3 -c "import sys,json; [print(x['decoder'], x['lag_seconds']) for x in json.load(sys.stdin)['decoders']]"

# Connection headroom (limit is 200)
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -tAc 'SELECT count(*) FROM pg_stat_activity'
```

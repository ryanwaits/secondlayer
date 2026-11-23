# Production topology

## Hosts

| Host | Role | Compose dir | Notes |
|---|---|---|---|
| app-server | API, indexer, decoder, worker, Caddy, Postgres | `docker/prod/docker-compose.yml` + `docker-compose.hetzner.yml` | AX52. Chain DB lives here until the v2 cutover. |
| node-server | stacks-node, bitcoind | `docker/hosts/node-server/` | AX162-S. |
| workload-host | One hosted stack per account (Caddy + `packages/workload` gateway) | `docker/workload-host/` | Runbook: `docs/internal/runbook/workload-host.md`. |
| db-server | Stacks Postgres on its own host, reached by app-server over WireGuard | `docker/hosts/db-server/docker-compose.yml` | AX162-1. Provisioned; the chain DB moves here at the v2 cutover (`docs/internal/runbook/v2-cutover.md`). |
| stacks-feeder | Genesis sync for the v2 chain DB | `docker/hosts/feeder/docker-compose.yml` | Temporary. Stays stopped after the cutover snapshot. Never run on node-server or app-server. |

SSH: `ssh app-server` / `ssh node-server` — direct, no jump host. Each
machine authenticates with its own key; add a new machine by appending its public
key to `~/.ssh/authorized_keys` on both hosts rather than copying an existing key.
Compose project lives at `/opt/secondlayer/docker` on app-server.

- **app-server** — everything below.
- **node-server** — the stacks-node. Pushes the event-observer
  firehose to `indexer`; also serves RPC (`:20443`) for tx-proof endpoints.
  Runs the eval-hook fork image (`sl-4.0.7`) with
  `events_keys = ["*", "storage", "contract_calls", "state_writes"]` since
  2026-11-23, so `vm_events` / `state_writes` land for every new block.

## Containers (all required unless noted)

| Container | Role |
|---|---|
| `secondlayer-postgres-1` | **Chain DB** — blocks, transactions, raw events, `decoded_events`. Bind mount `/opt/secondlayer/data/postgres` (~200GB, genesis→tip). |
| `secondlayer-postgres-platform-1` | **Control-plane DB** (`secondlayer_platform`) — accounts, api_keys, subgraph registry + tenant schemas, sessions. Bind mount `/opt/secondlayer/data/postgres-platform`. |
| `secondlayer-api-<N>` ×2 | The two API replicas behind Caddy (`api.secondlayer.tools`). `<N>` is Compose's instance counter and **increments every rolling deploy** (e.g. 94/95 → 98/99). Always exactly two; the suffix means nothing. |
| `secondlayer-caddy-1` | Load balancer + TLS in front of the api replicas. |
| `secondlayer-indexer-1` | Chain ingestion (event-observer receiver) + Streams bulk/R2 exports. |
| `secondlayer-decoder-1` | Decodes raw events → `decoded_events` (the Index plane). Backfills via `packages/indexer/src/decode/BACKFILL.md`. |
| `secondlayer-worker-1` | Crons: credits refill, spend-cap alerts. |
| `secondlayer-redis-1` | Rate limits. |
| `secondlayer-walg-backup-1` | WAL-G postgres backups (chain DB WAL archiving → `/opt/secondlayer/data/wal_archive`). |
| `secondlayer-walg-backup-platform-1` | Same for the control-plane DB (`/opt/secondlayer/data/wal_archive_platform` → `s3://secondlayer-db-backups/pg-platform`). |
| `secondlayer-agent` | Log watcher → Slack alerts (the thing that pages you). No DB of its own. |
| `secondlayer-migrate-1` | One-shot migration runner, re-run by every deploy. **`Exited (0)` is its healthy state.** |

## Operational rules (each one paid for in incidents)

1. **Deploys go through `docker/scripts/deploy.sh` only.** Its `APP_SERVICES`
   allow-list deliberately never touches postgres. After `git reset`, it
   `bun install --frozen-lockfile`s the host checkout so timer scripts
   (`slack-gate` / Jev) match the lockfile. Images do not share that
   `node_modules`.
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
7. No subgraph or webhook processors run in prod. Hosted subgraphs and
   webhooks are not offered; they run on self-host (`docker/oss/`) only.

## Quick checks

```bash
# Everything up + healthy (expect only migrate as Exited (0))
docker ps -a --format '{{.Names}} {{.Status}}'

# Chain DB is the real cluster, not a husk
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -tAc 'SELECT count(*), max(height) FROM blocks'

# Decoder lags (tens of seconds = at tip)
docker exec secondlayer-decoder-1 curl -s localhost:3710/health | \
  python3 -c "import sys,json; [print(x['decoder'], x['lag_seconds']) for x in json.load(sys.stdin)['decoders']]"

# Connection headroom (limit is 200)
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -tAc 'SELECT count(*) FROM pg_stat_activity'
```

## Backfill checkpoint runbook (op-scoped cursor)

Backfill operations (`kind: backfill` — tip-first history fills, gap repair)
checkpoint on their OWN row (`subgraph_operations.cursor_block`), never on the
live subgraph cursor. Written blocks advance it conditionally inside the same
transaction as their rows; a resumed/requeued op starts at `cursor_block + 1`.

- **Stuck backfill**: `status = running` with `cursor_block` frozen across
  minutes → check processor logs for repeated block errors (it halts rather
  than skips on missing source blocks).
- **"cursor race lost" warnings**: one writer lost a conditional advance —
  benign in isolation (the winner committed the block). A FLOOD of them means
  a zombie runner is replaying a claimed op: check for two processor
  containers / a stale lease.
- **Accumulator subgraphs (`ctx.increment`, or `findOne` read-modify-writes)**: backfill and
  tip-first are REJECTED at the API for these (`*_NON_REPLAYABLE_HANDLER`).
  Genuine gaps below a backfill cursor on an accumulator cannot be repaired in
  place — the safe re-run is a full `reindex` (schema-dropping, exactly-once).
- `skippedByCursor` in reindex progress logs counts replay-guard skips — a
  nonzero value after a crash-resume is the system working as intended.

## vm_events / fork image (node-server)

node-server runs the fork image with the VM keys on. History from genesis
came from the feeder's re-sync (the v2 DB); new blocks come from this node.
Unknown keys panic on a stock image, so a rollback to stock
`stacks-core:4.0.7` must also set `events_keys = ["*"]`. Both images share
the same chainstate format, so the rollback is image + config only.
Miners/signers never get `"storage"` / `"contract_calls"`.

Every fork release (e.g. epoch 4.1) runs on the feeder first: witness checks
(`marf-witness` built from the same fork branch) plus a stock-vs-fork diff
of blocks/transactions/events, then node-server.

Do not extract a Hiro chainstate tarball into a collecting node's
`STACKS_DATA_DIR`: archive chainstate skips Clarity execution, so the hook
never sees that history.

Canonical steps:
[docs/internal/runbook/genesis-feeder.md](../internal/runbook/genesis-feeder.md).

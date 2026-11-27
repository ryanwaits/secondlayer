# Production topology

## Hosts

| Host | Role | Compose dir | Notes |
|---|---|---|---|
| app-server | API, indexer, decoder, worker, Caddy, Postgres | `docker/prod/docker-compose.yml` + `docker-compose.hetzner.yml` | AX52. Chain DB moved to db-server at the v2 cutover (2026-11-22). Runs the hourly sampled block proof check (`secondlayer-witness-check.timer`). |
| node-server | stacks-node, bitcoind | `docker/hosts/node-server/` | AX162-S. |
| workload-host | One hosted stack per account (Caddy + `packages/workload` gateway) | `docker/workload-host/` | Runbook: `docs/internal/runbook/workload-host.md`. |
| db-server | Stacks Postgres on its own host, reached by app-server over WireGuard | `docker/hosts/db-server/docker-compose.yml` | AX162-1. Chain DB since the v2 cutover (2026-11-22). |

SSH: `ssh app-server` / `ssh node-server` — direct, no jump host. Each
machine authenticates with its own key; add a new machine by appending its public
key to `~/.ssh/authorized_keys` on both hosts rather than copying an existing key.
Compose project lives at `/opt/secondlayer/docker/prod` on app-server.

- **app-server** — everything below.
- **node-server** — the stacks-node. Pushes the event-observer
  firehose to `indexer`; also serves RPC (`:20443`) for tx-proof endpoints.
  Runs the eval-hook fork image (`sl-4.1.0`) with
  `events_keys = ["*", "storage", "contract_calls", "state_writes"]` since
  2026-11-23, so `vm_events` / `state_writes` land for every new block.

## Containers (all required unless noted)

| Container | Role |
|---|---|
| (none) | **Chain DB** is Postgres on db-server, reached via `SOURCE_DATABASE_URL` and backed up by WAL-G on db-server. Query from the app-server host: `cd /opt/secondlayer/docker; set -a; . ./.env; set +a; psql "$SOURCE_DATABASE_URL"` (never print the env file). |
| `secondlayer-postgres-platform-1` | **Control-plane DB** (`secondlayer_platform`) — accounts, api_keys, subgraph registry + tenant schemas, sessions. Bind mount `/opt/secondlayer/data/postgres-platform`. |
| `secondlayer-api-<N>` ×2 | The two API replicas behind Caddy (`api.secondlayer.tools`). `<N>` is Compose's instance counter and **increments every rolling deploy** (e.g. 94/95 → 98/99). Always exactly two; the suffix means nothing. |
| `secondlayer-caddy-1` | Load balancer + TLS in front of the api replicas. |
| `secondlayer-indexer-1` | Chain ingestion (event-observer receiver) + Streams bulk/R2 exports. |
| `secondlayer-decoder-1` | Decodes raw events → `decoded_events` (the Index plane). Backfills via `packages/indexer/src/decode/BACKFILL.md`. |
| `secondlayer-worker-1` | Crons: credits refill, spend-cap alerts. |
| `secondlayer-redis-1` | Rate limits. |
| `secondlayer-walg-backup-platform-1` | Same for the control-plane DB (`/opt/secondlayer/data/wal_archive_platform` → `s3://secondlayer-db-backups/pg-platform`). |
| `secondlayer-agent` | Log watcher → Slack alerts (the thing that pages you). No DB of its own. |
| `secondlayer-migrate-1` | One-shot migration runner, re-run by every deploy. **`Exited (0)` is its healthy state.** |
| `secondlayer-archive-job-run-*` | Archive publish one-off (profile `jobs`), present only while `secondlayer-archive-publish.service` runs. Deploys leave it alone and wait for it only when they carry a migration. |

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
3. **Husk canaries**: the platform postgres healthcheck fails against a
   freshly-initialized data dir (`PLATFORM_MIN_ACCOUNTS` floor in the server
   `.env`), so dependents refuse to start on an empty DB.
   `scripts/preflight-data.sh` (wired into deploy.sh) checks db-server's
   `blocks` count and the platform accounts count, and refuses to deploy
   against a husk.
4. **Recreate `postgres-platform` deliberately.** Service pools with cached DNS
   can hold stale connections; `docker restart` all dependents afterwards,
   including `walg-backup-platform`.
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
psql "$SOURCE_DATABASE_URL" \
  -tAc 'SELECT count(*), max(height) FROM blocks'

# Decoder lags (tens of seconds = at tip)
docker exec secondlayer-decoder-1 curl -s localhost:3710/health | \
  python3 -c "import sys,json; [print(x['decoder'], x['lag_seconds']) for x in json.load(sys.stdin)['decoders']]"

# Connection count
psql "$SOURCE_DATABASE_URL" \
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
Image `sl-4.1.0` (`@sha256:99837f90…`) since 2026-11-27, swapped at
height 9,591,377. Unknown keys panic on a stock image, so a rollback to stock
`stacks-core:4.1.0` must also set `events_keys = ["*"]`. Both images share
the same chainstate format, so the rollback is image + config only.
The previous fork image (`sl-4.0.7@sha256:772b5451…`) is a rollback only
before epoch 4.1 activates (Bitcoin 979,500): 4.0.7 cannot follow the chain
past it. Miners/signers never get `"storage"` / `"contract_calls"`.

Every fork release (e.g. epoch 4.1) runs on a temporary test node first, then
node-server. The genesis feeder that did this until 2026-11-27 is gone; its
chainstate (fork `sl-4.1.0`, height 9,593,360) is in R2 at
`secondlayer-db-backups/chainstate/mainnet-sl-4.1.0-h9593360/` with a
MANIFEST. Rent a cloud box, restore it, run `docker/hosts/feeder/` on the new
image, let it catch up, then gate on witness checks (`marf-witness` built from
the same fork branch) plus a stock-vs-fork diff of blocks/transactions/events
over at least 500 new blocks. Delete the box after.

In steady state, `secondlayer-witness-check.timer` on app-server proves 6
random blocks an hour end to end with `secondlayer verify block --rows`
(`docker/systemd/README.md`).

Do not extract a Hiro chainstate tarball into a collecting node's
`STACKS_DATA_DIR`: archive chainstate skips Clarity execution, so the hook
never sees that history.

Canonical steps:
[docs/internal/runbook/genesis-feeder.md](../internal/runbook/genesis-feeder.md).

### Digesting vm rows

`vm_events` keys a row to its transaction by `(block_height, tx_index)`; it
has no `tx_id` column. Digest prod VM rows with the transaction joined back:

```sql
SELECT n.block_height, count(*),
       md5(string_agg(concat_ws(chr(124), n.ordinal, t.tx_id, n.type, n.data::text), chr(10) ORDER BY n.ordinal))
  FROM vm_events n
  LEFT JOIN transactions t ON t.block_height = n.block_height AND t.tx_index = n.tx_index
 WHERE n.block_height = ANY($heights)
 GROUP BY n.block_height;
```

A database still on the old shape (a `tx_id` column, for example the R2 repair
source or an old-DB snapshot) digests `concat_ws(chr(124), ordinal, tx_id, type,
data::text)` straight from `vm_events`. Both forms give the same md5 per height.

### Rewriting a large live table

A shape change on a big live chain table runs through
`packages/indexer/src/live-rewrite.ts --table <name>`: `prepare`, `copy`,
`index`, `verify`, `preflight`, then a deploy whose migration calls
`swapLiveRewrite`. Ingest never stops until the swap. The old table stays as
`<name>_old` until dropped by hand. Rollback before the swap is
`abort --apply`, which drops only tool-created objects.

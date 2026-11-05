# Infrastructure

## Architecture

Two-server setup:

| Server | Hardware | SSH | Services |
|--------|----------|-----|----------|
| App server | AX52 | `ssh app-server` | indexer, API, Postgres, Caddy, worker, agent |
| Node server | AX162-S | `ssh node-server` | bitcoind, stacks-node |

The node server pushes Stacks block events to the app server indexer on port 3700. App server runs `postgres:17-alpine`.

---

## Quick Reference

```bash
# App server — run from /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# Node server — run from /opt/secondlayer/docker/node-server
# Just use: docker compose
```

> Always use both compose files on app server. Plain `docker compose` creates a fresh named volume instead of using the bind-mounted data at `/opt/secondlayer/data/postgres`.

---

## Initial Setup

### App Server

```bash
ssh app-server
git clone <repo> /opt/secondlayer
cd /opt/secondlayer/docker
bash scripts/bootstrap.sh
```

`bootstrap.sh` phases:
1. Provisions Docker, UFW (22/80/443), fail2ban, systemd service
2. Pre-flight: checks `.env`, disk space (>200GB required)
3. Starts: postgres → migrate → api, indexer, worker, provisioner
4. Starts caddy

Flags:
```bash
bash scripts/bootstrap.sh --skip-provision   # skip OS provisioning
bash scripts/bootstrap.sh --data-dir /path   # override DATA_DIR
```

After provisioning node server, open firewall:
```bash
ufw allow from <node-server-ip> to any port 3700
```

### Node Server

```bash
ssh node-server
git clone <repo> /opt/secondlayer
bash /opt/secondlayer/docker/node-server/setup.sh
# prompts for app server IP
```

`setup.sh`:
- Installs Docker, UFW, fail2ban, jq
- Formats `/dev/nvme0n1` → `/data/bitcoin`, `/dev/nvme1n1` → `/data/stacks`
- Generates `bitcoin.conf`, `Config.toml`, `.env` with random RPC password
- Installs systemd service (`secondlayer-node`)
- Starts bitcoind (IBD begins immediately)

> **Gotcha:** `STACKS_DATA_DIR` in `.env` (default `/data/stacks`) must match where chainstate actually lives on disk. If using a snapshot restore, extract to the path in `.env` — a mismatch causes full re-sync from genesis.

**Note:** `bitcoin.conf` must be copied into `$BITCOIN_DATA_DIR` before starting, and the data dir must be owned by UID 1000:
```bash
cp bitcoin.conf $BITCOIN_DATA_DIR/
chown -R 1000:1000 $BITCOIN_DATA_DIR
```

---

## Genesis Sync

Full chain sync from block 0. Takes ~10-14 days total. **All steps are manual** — stacks-node does not auto-start.

### Steps

**1. Start bitcoind** — IBD begins immediately

```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose up -d bitcoind
```

Monitor progress (~1-3 days to reach block 666050):
```bash
ssh node-server
RPC_PW=$(grep BITCOIN_RPC_PASSWORD /opt/secondlayer/docker/node-server/.env | cut -d= -f2)
docker exec secondlayer-bitcoind-1 bitcoin-cli -rpcuser=stacks -rpcpassword=$RPC_PW \
  getblockchaininfo | jq '{blocks,headers,verificationprogress}'
```

**2. Start app server with tip follower disabled** (do this while Bitcoin syncs)

```bash
ssh app-server
cd /opt/secondlayer/docker
# Truncate DB for clean genesis sync
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "TRUNCATE blocks, transactions, events, jobs, deliveries, index_progress CASCADE;"
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d
```

**3. Start stacks-node** — only after bitcoind blocks > 666050

```bash
# Verify Bitcoin is past Stacks genesis burn height
ssh node-server
RPC_PW=$(grep BITCOIN_RPC_PASSWORD /opt/secondlayer/docker/node-server/.env | cut -d= -f2)
docker exec secondlayer-bitcoind-1 bitcoin-cli -rpcuser=stacks -rpcpassword=$RPC_PW getblockcount
# Must be > 666050

cd /opt/secondlayer/docker/node-server
docker compose up -d stacks-node
# Bitcoin and Stacks sync in parallel from here (~3-7 days)
```

Monitor:
```bash
# Node server
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose logs -f stacks-node"

# App server
ssh app-server "cd /opt/secondlayer/docker && \
  $COMPOSE logs -f indexer"
```

**4. After sync completes**

```bash
ssh app-server
cd /opt/secondlayer/docker

# Check for placeholder transactions (excluding burnchain ops which legitimately have raw_tx = '0x00')
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT COUNT(*) FROM transactions WHERE raw_tx = '0x00' AND type_id NOT IN (1,2,3,4,5);"
# Should be 0. ~700 burnchain operations (PoX stacking, STX transfers via BTC) have raw_tx = '0x00' by design.

# Re-enable tip follower
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer
```

### Re-sync from genesis

```bash
# Node server: wipe stacks chainstate (check STACKS_DATA_DIR in .env)
ssh node-server "source /opt/secondlayer/docker/node-server/.env && rm -rf \${STACKS_DATA_DIR}/mainnet \${STACKS_DATA_DIR}/event_observers.sqlite"
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose stop stacks-node && docker compose start stacks-node"

# App server: truncate DB
ssh app-server "docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c 'TRUNCATE blocks, transactions, events, jobs, deliveries, index_progress CASCADE;'"
```

---

## Daily Operations

### Logs

```bash
# App server
$COMPOSE logs --tail 50
$COMPOSE logs -f indexer

# Node server
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose logs -f stacks-node"
ssh node-server "cd /opt/secondlayer/docker/node-server && docker compose logs --since 30m bitcoind"
```

### Health Checks

```bash
# App server services
$COMPOSE ps
docker stats --no-stream

# Indexer
curl -s localhost:3700/health | jq
curl -s localhost:3700/health/integrity | jq

# API
curl -s localhost:3800/health | jq
curl -s localhost:3800/status | jq

# Stacks node tip (run from node server)
ssh node-server "curl -s localhost:20443/v2/info | jq '{burn_block_height, stacks_tip_height}'"

# Compare node vs indexer tip
echo "node:" && ssh node-server "curl -s localhost:20443/v2/info | jq .stacks_tip_height"
echo "indexer:" && curl -s localhost:3700/health | jq .lastSeenHeight

# DB stats
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "SELECT MIN(height), MAX(height), COUNT(*) FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "SELECT (MAX(height)-MIN(height)+1)-COUNT(*) AS missing FROM blocks WHERE canonical=true;"
docker exec secondlayer-postgres-1 psql -U secondlayer \
  -c "SELECT pg_size_pretty(pg_database_size('secondlayer'));"

# Bitcoin sync (node server)
ssh node-server
RPC_PW=$(grep BITCOIN_RPC_PASSWORD /opt/secondlayer/docker/node-server/.env | cut -d= -f2)
docker exec secondlayer-bitcoind-1 bitcoin-cli -rpcuser=stacks -rpcpassword=$RPC_PW \
  getblockchaininfo | jq '{blocks,headers,verificationprogress}'
```

### Contracts

```bash
# Total indexed contracts
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT count(*) FROM contracts;"

# Top contracts by call count
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT name, contract_id, call_count FROM contracts ORDER BY call_count DESC LIMIT 10;"

# ABI cache stats
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT count(*) FILTER (WHERE abi IS NOT NULL) AS cached, count(*) AS total FROM contracts;"

# Test API endpoint
curl -s -H "Authorization: Bearer $TOKEN" "https://api.secondlayer.tools/api/contracts?q=bns" | jq
```

### Disk Usage

```bash
# App server
df -h /opt/secondlayer
du -sh /opt/secondlayer/data/postgres
docker system df

# Node server
ssh node-server "df -h /data && du -sh /data/bitcoin /data/stacks"
```

### Restart & Update

```bash
# Restart single service
$COMPOSE restart indexer

# Full rebuild + deploy
cd /opt/secondlayer && git pull
cd docker && $COMPOSE up -d --build

# Single service rebuild
$COMPOSE up -d --build indexer

# Config/env change only (no rebuild)
$COMPOSE up -d --force-recreate indexer

# Scale workers
$COMPOSE up -d --scale worker=3

# Node server: update stacks-node (edit docker-compose.yml image tag first)
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose pull stacks-node && docker compose up -d stacks-node

# Node server: full restart
docker compose down && docker compose up -d
```

---

## Host Maintenance (patch + reboot)

Proven 2026-10-22. Reboot one host at a time, in this order: feeder →
workload-host → node-server → app-server. Never node-server and app-server
together: stacks-node retries undelivered events through event-proxy, so one
side down is no gap.

**Before:** record indexer `/health/integrity` (`gapCount`), missing canonical
blocks, decoder lag, Runes checkpoint vs bitcoind tip (Health Checks above).

**Stop by hand.** Containers have a 10s stop timeout, so a plain reboot
SIGKILLs mid-flush:

```bash
docker stop -t 600 secondlayer-stacks-node-1     # node-server
docker stop -t 1200 secondlayer-bitcoind-1       # node-server
docker stop -t 300 <each postgres container>
systemctl kill -s SIGINT ord-runes               # feeder + app-server; graceful in ~5s
```

**Gotchas**

- A pending docker-ce/containerd upgrade restarts dockerd, which kills
  containers after 10s. `apt-mark hold` the docker packages, upgrade the rest
  with `NEEDRESTART_SUSPEND=1`, stop gracefully, then unhold, upgrade, reboot.
- `unless-stopped` + a manual `docker stop` = not restarted on boot. Feeder,
  node-server and the `secondlayer-bitcoin` project on app-server need an
  explicit `docker start` after. The app-server main stack returns via
  `secondlayer.service` (`compose up -d`, which also runs migrate).
- `secondlayer.service` stops with `compose down`, so `secondlayer_default`
  is recreated on every app-server reboot. Nothing outside the prod project
  may depend on attaching to it. The Bitcoin plane is reached through the
  docker bridge gateway (`host.docker.internal:5443`) for exactly this reason
  (docs/internal/bitcoin-runtime.md).
- app-server: pause the runes-watch, health-alert, integrity-alert,
  archive-status and staging-health timers during the window (false pages).
- workload-host: a push to main auto-rolls tenants (~10 min); let it finish,
  and pause `secondlayer-workload-upgrade.timer` during the reboot.
- decoder and walg sidecars ignore SIGTERM (exit 137 after the timeout).
  Harmless: checkpointed / WAL re-pushed.
- The testnet stack (`secondlayer-testnet` project) is `unless-stopped` /
  `always` and independent of `secondlayer.service`. Pause
  `secondlayer-testnet-health.timer` during maintenance.

**After app-server is back**, all must hold before resuming the timers:

```bash
curl -s https://api.secondlayer.tools/public/status   # status healthy, no service "unavailable" (incl. bitcoin)
curl -s -H "Authorization: Bearer $KEY" "https://api.secondlayer.tools/v1/index/runes?limit=1"     # 200 with rows
curl -s -H "Authorization: Bearer $KEY" "https://api.secondlayer.tools/v1/streams/tip?chain=bitcoin"  # 200
```

plus the "before" numbers: `gapCount` 0, decoder lag ~0, Runes checkpoint at
the bitcoind tip.

---

## Testnet stack

Stacks canonical testnet, indexed from the tip forward (no history) on the
existing node-server and app-server. Isolated from mainnet: own compose
project (`secondlayer-testnet`), own Postgres, no shared network or Redis.
Only tenant webhook evaluators on the workload host read it, through Caddy
`/testnet/v1/{index,streams}/*` (restricted by `remote_ip`).

Prerequisites verified 2026-11-02: Compose 5.6.1 on both hosts;
`/data/bitcoin` is `nofail` in `fstab`.

**1. Node-server: restore, do not start the node yet**

```bash
scp -r docker/node-server-testnet node-server:/opt/secondlayer/docker/
cp /opt/secondlayer/docker/node-server-testnet/*.service /opt/secondlayer/docker/node-server-testnet/*.timer /etc/systemd/system/
systemctl daemon-reload; systemctl enable --now testnet-rpc-firewall testnet-disk-guard.timer
U=https://archive.hiro.so/testnet/stacks-blockchain; D=/home/stacks-testnet
mkdir -p $D /home/stacks-testnet-dl; cd /home/stacks-testnet-dl
S=$(curl -fsSL $U/testnet-stacks-blockchain-latest.sha256); H=${S%% *}; N=$(basename "${S##* }")
curl -fL -C - -o "$N" "$U/$N"; echo "$H  $N" | sha256sum -c
nice -n19 ionice -c3 tar --zstd --no-same-owner -xf "$N" -C $D
rm -f $D/event_observers.sqlite; cd ..; rm -rf stacks-testnet-dl
```

**2. App-server: stack first, because the node stalls until its observer answers**

```bash
mkdir -p /data/bitcoin/testnet-pg; cd /opt/secondlayer/docker
# write testnet/.env, chmod 600: new password, new token, current owner and tag. No values in chat or commits.
C="docker compose -p secondlayer-testnet -f testnet/docker-compose.yml --env-file testnet/.env"
$C up -d testnet-postgres; $C run --rm testnet-migrate; $C up -d testnet-indexer
cp systemd/secondlayer-testnet-health.* /etc/systemd/system/; systemctl daemon-reload
```

**3. Node-server: start, watch it catch up**

```bash
cd /opt/secondlayer/docker/node-server-testnet && docker compose -p secondlayer-testnet up -d
```

From app-server, `curl -s 37.27.171.220:21443/v2/info` shows `server_version`
4.0.5, `network_id` 2147483648, `parent_network_id` 3669344250, tip near
`api.testnet.hiro.so`, and matching `pox_consensus` at the same burn height.
Off-host, `nc -z 37.27.171.220 21443` must fail. Catch-up is serial: about
5,000 blocks plus 9,000 per day of snapshot age.

**4. App-server: after the first block**

```bash
$C up -d testnet-api testnet-decoder; systemctl enable --now secondlayer-testnet-health.timer
```

Check: off-host `curl -m5 65.21.135.94:3701/health` times out; from node-server
it returns 200. `/health/integrity` is `healthy`; `/health`
`observerJournal.network` is `testnet`. From the workload host with the token:
`https://api.secondlayer.tools/testnet/v1/streams/tip` returns ~tip; from
elsewhere it 404s. Mainnet Postgres `pg_stat_activity` shows no testnet client.

**Reset** (reset page, tip stuck, integrity not healthy, disk >= 80%):
`docker compose -p secondlayer-testnet down` on node-server,
`rm -rf /home/stacks-testnet`, repeat step 1 restore; on app-server
`$C down; rm -rf /data/bitcoin/testnet-pg`, then steps 2-4. Tenant cursors
recover on their own.

After any restore, the node's boot block lands at height 0 and integrity reports a false `1-<start>` gap. Delete that one `blocks` row on the testnet Postgres, then set `index_progress.last_contiguous_block` to the tip.

**Removal**: both projects `down -v`, delete data dirs and `.env`, disable the
units and timers, delete the deploy hook + Caddy block + `extra_hosts`, deploy.

### Shared testnet webhook stack

One tenant stack, owned by a reserved internal account, serves every testnet
webhook for free. Customers use `https://api.secondlayer.tools/testnet` with
their own key; the workload gateway checks it, skips the credit gate, and
forwards `/testnet/api/webhooks*` to the shared stack with the caller's account
in `x-secondlayer-account-id`. The stack reads the testnet API above, keeps its
own Postgres and cursor, and runs with `TESTNET_WEBHOOK_STACK=true`. Every
other tenant is unchanged. Testnet has no outage emails or pushes (the incident
and push watches skip it). Capacity: 10 webhooks per account, 500 in total
(`TESTNET_CAPACITY`); nothing reclaims abandoned accounts, so to free room
delete by `account_id` in the stack's Postgres or raise the constant.

Do this after the testnet stack is at tip and this is deployed:

1. Mint internal account `testnet-webhooks@secondlayer.tools` server-side with
   `accounts.internal = true`, the Sentinel way. No MX, so nobody can sign in.
2. In `/opt/secondlayer-workload/workload.env` set `TESTNET_STACK_ACCOUNT_ID`,
   `TESTNET_API_URL=https://api.secondlayer.tools/testnet` and
   `TESTNET_API_KEY=<testnet INSTANCE_TOKEN>`. Restart the workload service.
   All three or none: a partial set is logged and ignored.
3. Provision by internal call, not a customer POST. Before anything else,
   confirm `TESTNET_WEBHOOK_STACK=true` and the testnet URL are in both `api`
   and `webhook-service` env (names and booleans only).
4. Live test: a `print_event` webhook on an `ST...` contract, a receiver you
   control, a delivery within minutes; a second account cannot list it; the
   mainnet tenants' webhooks keep delivering and their `.env` are unchanged.

If the testnet chain is reset, the evaluator rewinds its own cursor
(`testnet_cursor_reset` in the webhook-service log). `TESTNET_API_KEY` lives in
`webhook-service` only.

---

## Tip Follower

Polls the stacks-node RPC when blocks stop arriving (node restart, network issues). Only fetches a small window near chain tip — bulk gaps handled by integrity auto-backfill.

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `TIP_FOLLOWER_ENABLED` | `true` | Set `false` during genesis sync |
| `TIP_FOLLOWER_TIMEOUT` | `60` | Seconds of silence before polling |
| `TIP_FOLLOWER_MAX_BLOCKS` | `10` | Max blocks per cycle |
| `TIP_FOLLOWER_INTERVAL` | `10` | Check interval (seconds) |

### Manage

```bash
# Disable
TIP_FOLLOWER_ENABLED=false $COMPOSE up -d --force-recreate indexer

# Re-enable
TIP_FOLLOWER_ENABLED=true $COMPOSE up -d --force-recreate indexer

# Check status
$COMPOSE logs indexer | grep -i "tip follower"
```

---

## Database

### Connect & Inspect

```bash
docker exec -it secondlayer-postgres-1 psql -U secondlayer -d secondlayer

# Check gaps
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT * FROM index_progress;"

# Run the CLI against prod (published release, in a container on the compose
# network). The host checkout has no built packages — don't run packages/cli/src.
docker/scripts/sl.sh verify raw --against https://archive.secondlayer.tools/latest.json
```

### Backup Strategy

This section covers the **shared control-plane DB**. For per-tenant Postgres
backups (hourly dumps, 7d/30d retention ladder, restore runbook), see
[`TENANT_BACKUPS.md`](./TENANT_BACKUPS.md).

Three-layer backup system with ~5-minute RPO:

| Schedule | Script | What | Retention |
|----------|--------|------|-----------|
| Every 5 min | `sync-wal.sh` | WAL segments → Storage Box | 24h local, synced offsite |
| Daily 3 AM | `backup-postgres.sh` | `pg_dump \| gzip` (~15GB) | 7 days |
| Weekly Sun 4 AM | `backup-basebackup.sh` | `pg_basebackup` (physical) | 14 days |
| Daily 5 AM | `upload-snapshot.sh` | rsync all backups → Storage Box | mirrors local |

**WAL archiving** is configured in `docker-compose.hetzner.yml` via postgres `command:` flags:
- `wal_level=replica` — enables WAL archiving
- `archive_mode=on` — archives completed WAL segments
- `archive_command` — copies segments to `/wal_archive/` (mounted at `$DATA_DIR/wal_archive`)
- `archive_timeout=300` — forces archive every 5 min even if segment not full

WAL archive dir must be owned by the postgres user (UID 70 in Alpine):
```bash
chown 70:70 $DATA_DIR/wal_archive
```

```bash
# Verify WAL archiving is active
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT * FROM pg_stat_archiver;"

# Manual pg_dump
docker exec secondlayer-postgres-1 pg_dump -U secondlayer secondlayer | gzip > backup-$(date +%F).sql.gz
```

**Cron jobs (app server):**
```bash
# WAL sync (every 5 min)
*/5 * * * * /opt/secondlayer/docker/scripts/sync-wal.sh >> /opt/secondlayer/data/backups/sync-wal.log 2>&1

# Daily pg_dump (3 AM)
0 3 * * * /opt/secondlayer/docker/scripts/backup-postgres.sh >> /opt/secondlayer/data/backups/backup-postgres.log 2>&1

# Weekly pg_basebackup (Sunday 4 AM)
0 4 * * 0 /opt/secondlayer/docker/scripts/backup-basebackup.sh >> /opt/secondlayer/data/backups/backup-basebackup.log 2>&1

# Upload all backups to Storage Box (5 AM)
0 5 * * * /opt/secondlayer/docker/scripts/upload-snapshot.sh >> /opt/secondlayer/data/backups/upload-snapshot.log 2>&1
```

### Offsite (Storage Box)

```bash
/opt/secondlayer/docker/scripts/upload-snapshot.sh
/opt/secondlayer/docker/scripts/upload-snapshot.sh --dry-run
ssh -p 23 $STORAGEBOX_USER@$STORAGEBOX_HOST ls -lh /backups/postgres/
ssh -p 23 $STORAGEBOX_USER@$STORAGEBOX_HOST ls -lh /backups/wal/
```

### Restore

**From pg_dump (logical restore):**
```bash
zcat backup.sql.gz | docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer
```

**From pg_basebackup + WAL (point-in-time recovery):**
1. Stop postgres
2. Replace `$DATA_DIR/postgres` with extracted base backup
3. Copy WAL files from Storage Box to `$DATA_DIR/wal_archive/`
4. Create `recovery.signal` in postgres data dir
5. Set `restore_command` in postgres config
6. Start postgres — it replays WAL to recover

**Automated restore from Storage Box:**
```bash
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --verify-only
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --dry-run
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh
```

### Tuning for Large Restores

```sql
-- Before restore
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET max_wal_size = '64GB';
ALTER SYSTEM SET autovacuum = off;
SELECT pg_reload_conf();

-- After restore
ALTER SYSTEM RESET ALL;
SELECT pg_reload_conf();
VACUUM ANALYZE;
```

---

## Backfill

### Auto (Integrity Loop)

Runs every 5 minutes. Replays blocks already in our DB (handles reorgs). Gaps the DB can't replay surface as `gaps_unfillable`; it never reaches an external provider.

The example stacks-node event observer ships `disable_retries = true` (signer-safe: a stuck indexer can never stall a co-located signer). A delivery that times out is skipped rather than retry-blocking the node, so the integrity loop above is what fills any block missed during an indexer blip. If you run a pure indexer with no co-located signer and want maximum delivery completeness, set `disable_retries = false` (and raise `timeout_ms`) in `Config.toml` — see the comment there for the tradeoff.

```bash
curl -s localhost:3700/health/integrity | jq
```

### Chainstate Snapshot (optional)

Bootstrap stacks-node from Hiro's archive (~800-900 GB) instead of syncing from scratch. Note: still need a backfill strategy for the indexer DB.

**Not for the `vm_events` observer.** A Hiro restore skips Clarity execution, so the eval-hook never sees that history. When node-server runs the fork image and collects `"storage"` / `"contract_calls"`, its `STACKS_DATA_DIR` must be the genesis-feeder's own chainstate (or empty disk). Collapse after IBD: [genesis-feeder.md](../../docs/internal/runbook/genesis-feeder.md#after-catch-up-collapse-to-one-hooked-follower). Unhooked `/v2` RPC may still use a Hiro snapshot on a **different** node.

```bash
ssh node-server

# 1. Download archive to /tmp (resumable)
curl --continue-at - -L -o /tmp/snapshot.tar.zst \
  https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.zst

# 2. Stop stacks-node
cd /opt/secondlayer/docker/node-server
docker compose stop stacks-node

# 3. Extract to STACKS_DATA_DIR (check .env — default /data/stacks)
source .env
tar --zstd -xf /tmp/snapshot.tar.zst -C ${STACKS_DATA_DIR:-/data/stacks}

# 4. Start stacks-node — first boot does sortDB migration (normal, takes a few minutes)
docker compose start stacks-node

# 5. Clean up after verifying node is syncing
rm /tmp/snapshot.tar.zst
```

> **CRITICAL:** `STACKS_DATA_DIR` in `/opt/secondlayer/docker/node-server/.env` must match the extraction path. A mismatch causes stacks-node to find an empty data dir and re-sync from genesis.
>
> First boot after snapshot restore runs a sortDB migration — this is normal and takes a few minutes. Do not kill the process.

---

## Troubleshooting

### Indexer not receiving blocks

1. Check stacks-node logs on node server for event observer errors
2. Verify `events_keys` in node server `Config.toml`. Stock / pre-fork image:
   leave `["*"]` — `"storage"` / `"contract_calls"` panic on start. After the
   eval-hook image is on this host, those keys add `vm_events`; flipping them
   on a Hiro-restored disk does **not** backfill history. Feeder then collapse:
   [genesis-feeder.md](../../docs/internal/runbook/genesis-feeder.md). Do not
   flip the keys as a “fix” for empty `vm_events`. `"state_writes"` (same
   image) records each block's named writes; `state`-level subgraphs read them
   once the instance holds them from the subgraph's `startBlock`, and
   `secondlayer verify subgraph --replay` needs them.
3. Check firewall: app server port 3700 must be open from node server IP
4. `disable_retries = false` in Config.toml — node retries failed deliveries. Integrity loop fills any remaining gaps via Hiro API

```bash
ssh node-server "ufw status"
ssh app-server "ufw status"   # must have node-server IP → 3700
```

### Node stuck on "missing PoX anchor block"

Upgrade stacks-node image tag in `docker-compose.yml`, then:
```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose pull stacks-node && docker compose up -d stacks-node
```

### Event dispatcher stuck

```bash
ssh node-server
cd /opt/secondlayer/docker/node-server
docker compose stop stacks-node
rm /data/stacks/event_observers.sqlite
docker compose start stacks-node
```

### DNS resolution failure (Ubuntu 24.04)

Containers can't resolve external hosts. Ubuntu's systemd-resolved binds 127.0.0.53 which fails inside Docker. Setup scripts configure `/etc/docker/daemon.json` automatically. Manual fix:

```bash
echo '{"dns":["8.8.8.8","1.1.1.1"]}' > /etc/docker/daemon.json
systemctl restart docker
docker run --rm alpine nslookup google.com  # verify
```

### High queue depth

```bash
$COMPOSE up -d --scale worker=3
```

### "Unknown payload type: N"

Rebuild indexer with latest `@secondlayer/stacks` package:
```bash
$COMPOSE up -d --build indexer
```

---

## Monitoring (Agent)

AI agent monitors services, auto-fixes safe issues, alerts via Slack.

```bash
curl -s localhost:3900/health | jq
$COMPOSE logs -f agent

# Disable AI actions
AGENT_AI_ENABLED=false $COMPOSE up -d --force-recreate agent

# Dry run (no mutations)
AGENT_DRY_RUN=true $COMPOSE up -d --force-recreate agent
```

# Genesis feeder (eval-hook write log)

How to collect **full** historical Clarity storage + nested `contract-call?`
traces. Internal. Not a public docs page.

The hook only sees txs this node **executes**. A Hiro / archive chainstate
snapshot skips that execution. Empty disk, IBD from genesis, or the log
starts at whatever height you first subscribed.

Product map: [vm-events.md](../vm-events.md). Node sample:
`stacks-core/sample/conf/mainnet-eval-hook-follower.toml`.

## Rules

| Do | Do not |
|---|---|
| Empty `working_dir` | Restore a Hiro / archive snapshot into it |
| `events_keys = ["*", "storage", "contract_calls"]` | `"*"` only — that omits `vm_events` |
| `vm_trace_max_bytes = 0` | Any positive cap — that **drops writes** (`type: "truncated"`) |
| `disable_retries = false`, `timeout_ms ≥ 120000` | `timeout_ms = 500` / `disable_retries = true` (signer-safe compose defaults) |
| Dedicated feeder | Same process as a snapshot RPC node |
| Bitcoin with every block | A pruned bitcoind |

Prod `docker/node-server/Config.toml` stays `events_keys = ["*"]` until that
image is this fork's binary. Unknown keys panic on start.

A `truncated` marker is not a cursor. It means that tx's later traces were
discarded. Indexer skips it (warn) and those writes are gone. Feeder must
never emit one.

## This deployment

Temporary Hetzner Cloud box in Falkenstein. One compose project
`secondlayer-feeder` on this VM (not node-server, not app-server). Prod
`node-server` stays `ghcr.io/stacks-network/stacks-core:4.0.1` with
`events_keys = ["*"]`. IBD is running.

| | |
|---|---|
| Host | `stacks-feeder` (`166546682`). SKU `cpx62` (16 vCPU / 32 GB / x86). Location `fsn1`. Label `role=eval-hook-feeder`. |
| IPv4 | `49.13.117.132` |
| SSH | `ssh -i ~/.ssh/id_ed25519_prod root@49.13.117.132` (Cloud key `macbook-prod`) |
| Runtime | `/opt/secondlayer-feeder` (compose + host `Config.toml` + `.env`). Git template is `docker/feeder/`. |
| Volume | `feeder-data` (`106907790`), 4 TB ext4 (resized from 1 TB). Automount `/mnt/HC_Volume_106907790`, bind `/data/feeder`. |
| Data | `/data/feeder/stacks` and `/data/feeder/postgres`. Never prod chainstate or prod Postgres. |
| Node image | `ghcr.io/ryanwaits/stacks-core:441e595@sha256:a9a881bd4193ea431902e429f41a3605c95ef6a2bf7d0591031f702c097f9f11` linux/amd64. `mem_limit` 24G. |
| Indexer image | `secondlayer-indexer:feat-eval-hook` built on this box from `feat/eval-hook-vm-events` (has `0131_vm_events.ts`). Not GHCR `:latest`. |
| Scratch DB | compose DNS `postgres-feeder:5432`, db/user `secondlayer_feeder` / `secondlayer`. Password only in host `.env`. |
| Observer | compose DNS `indexer-feeder:3700`. Host bind `127.0.0.1:3700` only. Not prod indexer. |
| Node RPC | `127.0.0.1:20443`. P2P `20444` (cloud firewall open). |
| Bitcoin RPC | `peer_host = "37.27.171.220"` port 8332. Allowlist: app-server `65.21.135.94` and this IPv4. Not `0.0.0.0/0`. |
| Cloud firewall | `stacks-feeder` (`11648111`): TCP 22 from operator `136.62.99.163/32`; TCP 20444 open. 3700 not published. |
| Watchdog | `docker/feeder/feeder-alert.sh` → `/opt/secondlayer-feeder/feeder-alert.sh`, `secondlayer-feeder-alert.timer` every 5m, Slack webhook in `alert.env`, log `/var/log/secondlayer-feeder-alert.log`. Read-only. `/v2/info` pages after 3 straight misses (IBD holds the chainstate lock); tip stall pages at 60m. |

`ccx43` (64 GB) failed with dedicated-core quota; `cpx62` is the fallback.
Stacks-node is capped at 24G so scratch Postgres + indexer fit on 32 GB.
Volume is 4 TB (quota raised, resized, ext4 grown). Upstream reports mainnet
chainstate ~1 TB (Mar 2026) growing ~2.5 GB/day, so 4 TB covers IBD.

Host `Config.toml` has `BITCOIN_RPC_PASSWORD` from node-server `.env`; git
keeps `CHANGE_ME`. `vm_trace_max_bytes = 0`.
`events_keys = ["*", "storage", "contract_calls"]`.
`OBSERVER_JOURNAL_ENABLED=false` (genesis `/new_block` ~80MB).

First scratch `vm_events` landed at height 9 (`map_set`). Height 0 is
genesis classic events only. Catch-up is days–weeks.

## Bring-up

1. Empty `/data/feeder/stacks`. Do not copy chainstate from Hiro or R2.
2. Bitcoin RPC is node-server (full-history). Feeder must be on the `:8332` allowlist.
3. Build `secondlayer-indexer:feat-eval-hook` on the box (confirm `0131` in the image).
4. `docker compose up -d postgres-feeder` → migrate → `indexer-feeder` healthy → `stacks-feeder`.
5. Catch-up is days–weeks. `/new_block` at height 0 is ~80MB; later blocks
   add `vm_events`. Raise any reverse-proxy body limit on this box only.
6. Confirm ingest: `vm_events.min` genesis-adjacent (first executed; 9 on
   this run), `count(*) > 0`. `min` near 9M means the wrong node.

```bash
cd /opt/secondlayer-feeder
docker compose up -d postgres-feeder
docker compose up migrate-feeder
docker compose up -d indexer-feeder
docker compose up -d stacks-feeder
curl -s localhost:20443/v2/info | jq .stacks_tip_height
docker compose exec -T postgres-feeder psql -U secondlayer -d secondlayer_feeder \
  -c 'SELECT min(block_height), count(*) FROM vm_events'
```

Start from `docker/feeder/Config.toml`, not the operator configs
(`docker/oss/`, `docker/stacks-node/`): those stay stock-safe with
`events_keys = ["*"]`, `timeout_ms = 500`, `disable_retries = true`. The feeder
needs the vm_events keys, `vm_trace_max_bytes = 0`, and
`event_dispatcher_blocking = true`. Wipe the
volume if it ever held a snapshot.

## After catch-up (collapse to one hooked follower)

The feeder is an IBD job, not a permanent second stacks-node. Once it is at
tip, history is in Postgres. Live traces need **one** hooked follower whose
chainstate came from that feeder (not a Hiro snapshot).

Do this only after the **fork image** is what `node-server` runs. Stock
binaries panic on `"storage"` / `"contract_calls"`. Until that image is
deployed, leave prod `docker/node-server/Config.toml` at `events_keys =
["*"]` and keep the feeder (or do not collect `vm_events` in prod).

1. **Snapshot the pair together** (same tip): feeder `working_dir` chainstate
   and the indexer chain DB (`blocks` / `transactions` / `events` /
   `vm_events`). If the feeder already POSTed `/new_block` at prod indexer
   `:3700`, the DB is already the product; still snapshot it so DR can restore
   both. Do not snapshot one without the other.
2. **Restore that pair onto the live observer.** On `node-server`: stop
   `stacks-node`, replace `STACKS_DATA_DIR` (default `/data/stacks`) with the
   feeder chainstate, start. Do **not** extract a Hiro
   `mainnet-stacks-blockchain-latest.tar.zst` into that dir. If IBD used a
   scratch indexer DB, restore it to app-server Postgres **before** pointing
   the observer at it (WAL-G: [db-backup-restore.md](./db-backup-restore.md)).
3. **Keep the keys on** so new blocks still emit `vm_events`:

   ```toml
   events_keys = ["*", "storage", "contract_calls"]
   vm_trace_max_bytes = 0
   disable_retries = false
   timeout_ms = 120000
   ```

   `vm_trace_max_bytes > 0` drops writes (`type: "truncated"`). Leave it `0`.
   Do not put these keys on a signer. `node-server` is the indexer observer,
   not a signer.
4. **Retire the IBD box.** History lives in Postgres (and canonical archive
   for classic `"*"` payloads). Do not re-execute the chain. Do not keep a
   spare genesis feeder. Unhooked RPC for `/v2` can stay a separate node;
   it must not be the observer.

Disaster recovery: restore the **feeder-descended** chainstate snapshot plus
indexer DB. Replay the trace log (and classic `/new_block`), not Clarity. A
Hiro chainstate restore on the observer makes pre-restore `vm_events` on a
reorg un-reproducible from that node.

## Check

- Node log has no `vm trace truncated for tx`.
- Indexer log has no `vm_event truncated by node cap`.
- `GET /v1/index/events?event_type=var_set&from_height=1` is non-empty
  (pox boot vars), not only recent heights.

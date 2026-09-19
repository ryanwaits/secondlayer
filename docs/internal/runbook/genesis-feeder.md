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

Temporary Hetzner Cloud box in Falkenstein. Stacks-node and the scratch
indexer are **not started**. Prod `node-server` is still
`ghcr.io/stacks-network/stacks-core:4.0.1`. Do not run `docker/feeder/`
as-is; those files still assume the feeder lives on node-server.

| | |
|---|---|
| Host | `stacks-feeder` (`166546682`). SKU `cpx62` (16 vCPU / 32 GB / x86). Location `fsn1`. Label `role=eval-hook-feeder`. |
| IPv4 | `49.13.117.132` |
| Volume | `feeder-data` (`106907790`), 1024 GB ext4. Automount `/mnt/HC_Volume_106907790`, bind `/data/feeder`. |
| Data | `/data/feeder/stacks` and `/data/feeder/postgres` (empty except `stacks/.keep`). Never `/data/stacks` on prod. |
| Image | `ghcr.io/ryanwaits/stacks-core:441e595` (`sha256:a9a881bd4193ea431902e429f41a3605c95ef6a2bf7d0591031f702c097f9f11`) linux/amd64. Pulled. Not running. |
| SSH | `ssh -i ~/.ssh/id_ed25519_prod root@49.13.117.132` (Cloud key `macbook-prod`) |
| Cloud firewall | `stacks-feeder` (`11648111`): TCP 22 from operator `136.62.99.163/32`; TCP 20444 open. Scratch indexer 3700 is not published. |
| Bitcoin RPC | node-server `:8332` allowlist: app-server `65.21.135.94` and this IPv4. Not `0.0.0.0/0`. |

`ccx43` (64 GB) failed with dedicated-core quota; `cpx62` is the fallback.
Cap stacks-node at 24G when it starts so scratch Postgres fits on 32 GB.
Cloud volume quota is 1 TB (`2048` GB create was `resource_limit_exceeded`).
Raise that limit before IBD if chainstate needs ≥1.2T, then
`hcloud volume resize feeder-data --size 2048` and grow the ext4 filesystem.

Copy `BITCOIN_RPC_PASSWORD` from node-server `.env` into the feeder
`Config.toml` on the host; do not commit it.

## Bring-up

1. Wipe the stacks working dir. Do not copy chainstate from Hiro or R2.
2. Point bitcoind at a full-history source; wait until it has genesis.
3. Start indexer (empty migrated Postgres) **before** stacks-node.
4. Start this fork's `stacks-node` with the sample follower config, observer
   `endpoint` at the indexer (`indexer:3700` in compose, `127.0.0.1:3700` on
   the host).
5. Catch-up is days–weeks. `/new_block` at height 0 is ~80MB; later blocks
   add `vm_events`. Raise any reverse-proxy body limit.
6. Confirm ingest: `vm_events` rows from height 1 onward (boot contracts),
   not only after you flipped keys at tip.

```bash
# indexer first
# then, from stacks-core:
stacks-node start --config sample/conf/mainnet-eval-hook-follower.toml
```

Compose `docker/oss/Config.toml` / `docker/stacks-node/Config.toml` already
have the keys. They still ship `timeout_ms = 500` and `disable_retries =
true` (signer-safe). For a feeder, override those two plus
`vm_trace_max_bytes = 0` and `event_dispatcher_blocking = true`. Wipe the
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

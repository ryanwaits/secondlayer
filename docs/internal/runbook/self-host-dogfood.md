# Self-host dogfood

Run what a self-host operator runs, end to end, on our own box. First target:
a Fast Pool-shaped operator with a signer node who wants Secondlayer next to it.
Internal. Not a public docs page.

Each phase has a pass line. Log every miss in [Findings](#findings) with the
exact command and output, then fix it in the product, not in this file.

## Topology

```
 node-server bitcoind (txindex)
        │  ssh tunnel :8332
 ┌──────▼─────── Mac mini M1, 16 GB ────────────────────────────────┐
 │  native, data on external 2 TB                                   │
 │  stacks-node 4.0.1 ──┬─► stacks-signer   :30000                  │
 │                      │   (events: stackerdb, block_proposal,     │
 │                      │    burn_blocks)                           │
 │                      └─► 127.0.0.1:3700                          │
 │                           │                                      │
 │  Docker Desktop (VM disk on external, 650 GB sparse)             │
 │                           ▼                                      │
 │                      secondlayer  signer-shared: no retries      │
 │                      + postgres   API :3800                      │
 └──────────────────────────────────────────────────────────────────┘
        archive.secondlayer.tools ──► bootstrap / verify / repair
```

The node and signer run outside the Secondlayer compose, the way an operator's
node already exists. Secondlayer runs `NODE_MODE=external`. Do not use the
`full-node` profile here: it has no signer and hides the co-location risk
this runbook exists to test.

## Machine gate

Floors are enforced at boot (`packages/shared/src/runtime/guardrails.ts`).

| Piece | RAM | Disk |
|---|---|---|
| Secondlayer app, mainnet | 4 GB | 600 GB |
| Secondlayer app, testnet | 4 GB | 80 GB |
| stacks-node chainstate, mainnet | - | ~1.3 TB measured |
| bitcoind, unpruned + txindex | - | ~700 GB, check at the time |
| Whole box, mainnet | 96 GB floor, 128 GB comfortable | 2.5-3 TB NVMe |

Mainnet only. The 96 GB row is the `full-node` profile's floor. We run
`external`, so the Secondlayer check is 4 GB.

### This box

Mac mini M1, 16 GB, external 2 TB. Everything on one disk doesn't fit
(~1.3 TB chainstate + ~700 GB bitcoind + ~550 GB index), so:

| Piece | Where | Size on the external |
|---|---|---|
| bitcoind | node-server, SSH tunnel to `localhost:8332` | 0 |
| stacks-node + signer | native macOS arm64 binaries | ~1.3 TB |
| Docker Desktop VM disk | external, sized 650 GB, sparse | what's written |
| Secondlayer index | inside the VM disk | forward-only: small; full: doesn't fit |

- Format the external APFS. exFAT can't hold the sparse VM disk image.
- SSD, not a spinning disk: chainstate reads are random. Check before phase 1.
- Docker Desktop: Settings → Resources → move the disk image location to the
  external drive, disk limit 650 GB, memory 8 GB. The boot check measures
  the VM disk's size (`resources.ts`, `statfs` on `DATA_DIR`), so 650 GB passes
  the 600 GB floor without writing 650 GB.
- RAM split: ~6 GB node + signer, 8 GB Docker, the rest macOS.

```bash
free -g; df -h; nproc
```

Pass: numbers written into Findings before anything is installed.

## Phase 1: bitcoind + stacks-node

1. Tunnel node-server's bitcoind RPC: `ssh -N -L 8332:127.0.0.1:8332 node-server`.
   A dropped tunnel stalls the node, which is its own useful test, but run
   it under `autossh` for long stretches.
2. stacks-node, native macOS arm64 binary from the `stacks-core` release that
   matches `docker/oss/docker-compose.yml` (4.0.1 at time of writing),
   `working_dir` on the external. Start from `docker/oss/Config.toml` and change:
   - `working_dir` to the external drive path
   - `[burnchain] peer_host = "127.0.0.1"`, RPC user/pass from node-server
   - `[node] stacker = true`
   - `[connection_options] auth_token = "<random>"` (the signer uses it)
3. Chainstate: a genesis sync takes days. A published chainstate snapshot is
   fine here, since we are not collecting eval-hook traces (that rule is in
   [genesis-feeder.md](genesis-feeder.md)).

```bash
curl -s localhost:20443/v2/info | jq '.stacks_tip_height, .burn_block_height'
```

Pass: `stacks_tip_height` within a few blocks of the explorer.

## Phase 2: signer

Run `stacks-signer` from the same release line as the node. Config per the
current Stacks signer docs (fields drift between releases, check before
copying): `node_host = "127.0.0.1:20443"`, `endpoint = "127.0.0.1:30000"`,
`auth_token` equal to the node's, a fresh `stacks_private_key`, `db_path`.

Signer observer in the node's `Config.toml`:

```toml
[[events_observer]]
endpoint = "127.0.0.1:30000"
events_keys = ["stackerdb", "block_proposal", "burn_blocks"]
```

We don't need to be in the signer set. An unregistered signer still gets
every proposal, and those events are what a stuck indexer would starve.

Pass: signer log shows block proposals arriving once per Stacks block.

## Phase 3: Secondlayer next to the node

```bash
secondlayer setup --network mainnet --node-mode external --skip-bootstrap --skip-verify
```

Bootstrap runs separately in phase 4 so each variant starts clean.

The node is native on the host, so the default `INDEXER_PORT` of
`127.0.0.1:3700` reaches the container. But `secondlayer observer` refuses a
loopback endpoint outside devnet, so render with the LAN IP, then change the
endpoint to `127.0.0.1:3700` by hand:

```bash
secondlayer observer --mode signer-shared --endpoint <lan-ip>:3700
```

That refusal is a finding: a node on the same host as Secondlayer is a real
operator topology. Log it.

Paste the stanza into the node's `Config.toml`, restart the node.
It should come out with `timeout_ms = 500`, `disable_retries = true`.

```bash
curl -s localhost:3800/health
secondlayer status
secondlayer doctor
```

Pass: health ok, `status` tip advancing with the node, signer still logging
proposals with no gaps.

## Phase 4: bootstrap variants

`bootstrap` refuses a non-empty database, so reset between variants.
`docker compose down -v` in the setup dir wipes Postgres and subgraph data:
only on this box.

| Variant | Command | What it proves |
|---|---|---|
| Short | `secondlayer bootstrap --against <manifest> --to-block 100000 --yes` | Pipeline works in minutes |
| Forward-only | `secondlayer bootstrap --against <manifest> --from-block <tip - 50000> --yes` | Small-disk path for webhooks-only operators |
| Full | `secondlayer bootstrap --against <manifest> --yes` | The real operator path. **Not on this box**: ~550 GB next to 1.3 TB chainstate fills the 2 TB. Project it from the short run's GB per 100k blocks |

`<manifest>` = `https://archive.secondlayer.tools/latest.json`.

Record for each: wall time, final DB size (`docker system df -v`, the
Postgres volume), exit code (0 restored, 1 diverged, 2 refused). Rows/s on the
short run checks the ~64k rows/s COPY number against a USB drive and a VM
we didn't tune.

Forward-only questions to answer:
- How big is the DB at the end? The boot floor ignores `--from-block` and
  still demands 600 GB (`guardrails.ts` keys on mode + network only). If the
  real size is far under, that's the case for a lower floor in this mode.
- Keep the observer connected during the restore. Blocks the node sends
  meanwhile are journaled and drained before the first live block. Check the
  `Bootstrap spool consumed` log: `ingested` > 0.
- The only gap should be archive tip + 1 to the node's tip when the restore
  started, as the CLI prints. Repair it after the next archive publish, then
  `verify raw` over it exits 0.

Pass: exit 0 on both, live tip joins the restored range.

## Phase 5: verify + repair

```bash
secondlayer verify all --against <manifest>
secondlayer verify all --against <manifest> --deep --from-block <n> --to-block <n+10000>
```

Break it on purpose, then repair:

```bash
# pick a height inside the restored range
psql "$DATABASE_URL" -c "delete from events where block_height = <h>;"
secondlayer verify raw --against <manifest> --from-block <h> --to-block <h>   # expect exit 1
secondlayer repair --against <manifest> --from-block <h> --to-block <h>       # plan
secondlayer repair --against <manifest> --from-block <h> --to-block <h> --apply
secondlayer verify raw --against <manifest> --from-block <h> --to-block <h>   # expect exit 0
```

Repair fetches are metered. Note whether the free allowance covered it and
what the prompt said before charging.

Pass: verify catches the hole, repair plans exactly that range, verify is
clean after.

## Phase 6: the signer test

This one matters most for signer operators.

1. `docker compose stop secondlayer` for 10 minutes.
2. Watch the signer log and `curl localhost:20443/v2/info` the whole time.
3. Start it again.

Pass:
- node tip keeps advancing and the signer keeps getting proposals while
  Secondlayer is down
- after restart, the missed range shows under `unfillableHeights` in the
  integrity health output (today nothing refills it on its own)
- `secondlayer repair --apply` over that range fills it once the archive
  covers those heights; note how long that wait was
- `secondlayer verify raw` over the outage window then exits 0

Then repeat with the observer switched to `--mode indexer` (retries on) to see
the stall we're protecting against. Revert after.

## Phase 7: product surfaces

Use Fast Pool's own contracts as the subject, so the demo matches what they'd
see.

| Surface | Try | Pass |
|---|---|---|
| Index | a `/v1` read on the pool contract's txs | matches explorer |
| Webhooks | `secondlayer webhooks` on a pool contract call, to a local receiver | fires once per call, survives restart |
| Webhook replay | replay over a historical range | idempotent, live cursor unmoved |
| Subgraphs | `secondlayer subgraphs deploy` a small delegation subgraph with a `startBlock` | catches up, reads match Index |
| Subgraph verify | `secondlayer verify subgraph:<name> --against <manifest>` | exit 0 |

## Phase 8: backup, restore, upgrade

```bash
secondlayer backup --out ./backups/$(date +%F)
secondlayer restore --from ./backups/<date>            # dry run
secondlayer restore --from ./backups/<date> --apply --force
secondlayer verify all --against <manifest>
```

Then upgrade per [/docs/self-host/upgrade](https://secondlayer.tools/docs/self-host/upgrade):
note the image, move one tag, check that subgraphs and webhooks come back.

Pass: restore round-trips, upgrade needs nothing that isn't in the docs.

## Findings

| Phase | What happened | Expected | Fix / issue |
|---|---|---|---|
| gate | | | |

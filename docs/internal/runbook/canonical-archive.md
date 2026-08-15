# Canonical archive operations

How to produce, attest, and operate the signed archive. Consumer commands
(`sl verify` / `sl repair` / `sl bootstrap`) live on
[Verified archive](https://www.secondlayer.tools/docs/archive). This file is
the producer side.

Host: `app-server`. Indexer container: `secondlayer-indexer-1`. Staging dir:
container `/data/archive/canonical-v1-staging`, host
`/opt/secondlayer/data/archive/canonical-v1-staging`. Node RPC:
`$STACKS_NODE_RPC_URL` (prod `http://37.27.171.220:20443`).

## Which job

| Job | Command |
| --- | --- |
| Twice-weekly publish | `docker/scripts/archive-publish.sh` (timer `secondlayer-archive-publish`, Wed + Sun 08:00) |
| Refresh status only | `bun run packages/indexer/src/archive/publish-status.ts --apply` |
| Node-audit a range | `bun run packages/indexer/src/archive/node-replay-auditor.ts` |
| Ship a signed attestation | `bun run packages/indexer/src/archive/publish-attestation.ts --attestation <path>` |
| Ship incident reports | `bun run packages/indexer/src/archive/publish-incidents.ts --apply` |
| Nightly continuity audit | `docker/scripts/canonical-audit-alert.sh` |
| Key ceremony | [archive-key-ceremony.md](./archive-key-ceremony.md) |

All `bun run packages/indexer/src/archive/…` invocations run **inside** the
indexer container (`cwd /app`).

```bash
ssh app-server 'docker exec secondlayer-indexer-1 bun run packages/indexer/src/archive/<script>.ts …'
```

## Publish a snapshot

`archive-publish.sh` is export → upload → promote → status. Each step gates the
next. Promotion refuses a bad signature, a coverage gap, a missing object, or a
regression.

```bash
# systemd timer (preferred)
systemctl start secondlayer-archive-publish.service

# or by hand
/opt/secondlayer/docker/scripts/archive-publish.sh
```

`docker exec` can hang after the child exits (2026-08-13: export finished,
wrapper killed at 6 h). The script recovers by watching the bind-mounted
`snapshots/` dir: a new signed manifest on disk is success regardless of the
exec exit code.

Export flags (if you run the exporter directly):

| Flag | Effect |
| --- | --- |
| `--to-block auto` | Bound at the burn-confirmation finality line |
| `--out <dir>` | Staging root |

Do not promote a snapshot whose `canonical-audit` inside the same export is
not `continuity.complete`.

## Two surfaces, one archive

The archive is published to **two** places and both have to move:

| Surface | What it is | Written by |
| --- | --- | --- |
| R2 bucket | Durable copy under `secondlayer/mainnet/canonical/v1/` | `upload-snapshot`, `promote-snapshot`, `publish-status` |
| Served tree | `archive.secondlayer.tools`, Caddy static root over the staging dir bind-mounted at `/srv/archive` | the exporter (partitions), plus the pointer mirror below |

Partitions land in the served tree because the exporter writes them there. The
two mutable pointers do not: `latest.json` and `status.json` are PUT to the
bucket, and reach the served tree only through `ARCHIVE_PUBLIC_DIR`
(`/data/archive/canonical-v1-staging`, set on the indexer service). Unset it and
the tree silently keeps serving whatever pointer it already had — which is how
`status.json` 404'd publicly for its entire life while the hourly refresh
reported success.

## Freshness cadence and thresholds

`status.json` calls the archive `stale` after 5 days without a promotion or
60k blocks behind finalized. The publish timer runs Wed + Sun, so the longest
healthy gap is 4 days.

**These two numbers are one setting.** A threshold below the cadence reports
`stale` on a healthy week and trains everyone to ignore the field (2026-08-15:
a weekly timer against a 48-hour objective, paging for a fault that did not
exist). A threshold above a full missed cycle stops catching real outages. If
you change the timer, change `DEFAULT_MAX_SECONDS_SINCE_PROMOTION` in
`packages/shared/src/archive/status.ts` with it — the archive produces roughly
7-9k blocks/day, so also check the result still lands inside the 60k height
rule.

## Node-audit a range

Compares each canonical height's `hash` + `index_block_hash` to a stacks-node
`/v3/blocks/{index_block_hash}` fetch. Recomputes both identities from the raw
bytes. Does **not** attest transactions or events — those are declared
`unattested-by-node` in the report.

```bash
# Detached. Log is bind-mounted, survives ssh drops.
ssh app-server 'docker exec -d secondlayer-indexer-1 sh -c "
  bun run packages/indexer/src/archive/node-replay-auditor.ts \
    --from-block 8648856 --to-block 8748855 \
    --out /data/archive/canonical-v1-staging \
    --snapshot <digest> \
    --concurrency 8 \
    > /data/archive/canonical-v1-staging/last-audit.log 2>&1
"'

# Progress (every 1000 heights) + JSON summary at the end
ssh app-server 'tail -f /opt/secondlayer/data/archive/canonical-v1-staging/last-audit.log'
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--from-block` / `--to-block` | required | Inclusive height window |
| `--out` | `./canonical-v1-staging` | Writes `attestations/<digest>/node.json` |
| `--snapshot` | unset → `pending/` | Snapshot digest to address the file under |
| `--concurrency` | `8` | In-flight `/v3/blocks` fetches. `1` is sequential |
| `--node-url` | `$STACKS_NODE_RPC_URL` | Node RPC |

Signs automatically when `STREAMS_SIGNING_PRIVATE_KEY` is in the container env.

`stats.mismatches` / `stats.node_unavailable` are exact counters.
`mismatches[]` / `unavailable[]` are capped at 200 (evidence, not totals).
Do not publish a report whose `stats` you have not read.

Pace at concurrency 8 is ~3–4k heights/min (network-bound). Full snapshot
0–8.7M is ~1.5 days. The 100k tip window is ~30 min.

Exit: `0` clean, `1` any mismatch, `2` crash.

### Epoch 4.0 headers

From height **8,665,568** (burn 960,230) Nakamoto headers are version `1`.
After `pox_treatment` the wire has `Vec<ProblematicTxMarker>` (`u32` count +
`u32 tx_index ‖ u8 category` each). An empty list is still four bytes, and
those bytes are in the signer-signature-hash preimage. Parser:
`packages/shared/src/node/nakamoto.ts`. Pre-fork (version `0`) is unchanged.

A clean pre-fork window and a dirty post-fork window is this bug, not chain
drift. Confirm with a single post-fork fetch before declaring divergence.

### Current published window (2026-08-13)

Snapshot `a2c22b25349a6f2577626bf7132547ef119664fb6e046a4c7822f52edc132108`
covers 0–8,748,855. `node.json` attests **8,648,856–8,748,855** (100k tip,
including the fork): 100,000 matches, 0 mismatches. Heights below 8,648,856
are `db-reconstructive` only.

`publish-attestation` refuses to overwrite an existing key. A second report
for the same digest is a new fact — delete the R2 object first, or wait for
the next snapshot.

## Publish an attestation

```bash
ssh app-server 'docker exec secondlayer-indexer-1 bun run \
  packages/indexer/src/archive/publish-attestation.ts \
  --attestation /data/archive/canonical-v1-staging/attestations/<digest>/node.json'
```

Refuses an unsigned document and a missing `snapshot_digest`. R2 key:
`secondlayer/mainnet/canonical/v1/attestations/<digest>/node.json`.

## Incidents

Source of truth: `docs/incidents/published/*.json`. The container does not
ship `docs/`, so copy the files in, then publish:

```bash
# dry-run
docker exec secondlayer-indexer-1 bun run \
  packages/indexer/src/archive/publish-incidents.ts

# apply (after docker cp of the JSON files)
docker exec secondlayer-indexer-1 bun run \
  packages/indexer/src/archive/publish-incidents.ts --apply
```

Writes `reports/incidents/<id>.json` plus `reports/incidents/index.json`
(newest first). Do not stage a second copy in the archive volume — it goes
stale the moment the repo copy changes.

## Decoder rebuild declarations

`packages/indexer/src/decode/service-manifests.ts` — one manifest per built-in
decoder (sBTC, pox-4, bns). Each says whether R2-alone can rebuild the output
tables and what else is required. Declarations only; stateful re-run is later
work. Read them before claiming a decoder is archive-rebuildable.

## Long-running monitors

`scripts/ops/monitor-helpers.sh` — `ssh_try`, `poll_ssh_until`,
`wait_for_container_process_gone`. Empty stdout is "retry", not "done". Source
it at the top of any poll loop that watches `docker exec` or `pgrep` over ssh.

## Related

- Consumer surface: `/docs/archive`
- Trust root: [archive-key-ceremony.md](./archive-key-ceremony.md)
- Host recovery: `docker/docs/PHASE1_RECOVERY_RUNBOOK.md`

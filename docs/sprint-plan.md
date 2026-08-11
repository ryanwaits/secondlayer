# Secondlayer self-host pivot with live archive

Status: proposal. Phase 1 implementation started with the exact observer receipt
journal and canonical coverage audit foundation. Assumes no hosted users. The existing node,
app server, indexer, databases, backups, and R2 remain running as private
archive-production infrastructure until a separate consolidation is approved.

## Outcome

Secondlayer becomes one self-hosted product:

> Run a complete Stacks data runtime beside your node. Bootstrap verified raw
> history, query decoded data, deploy TypeScript subgraphs, and prove every
> configured stage processed every block in scope.

Secondlayer also operates one best-effort public utility: an immutable,
full-genesis canonical archive on R2, plus exact observer journal ranges from
journal activation onward. It is not a hosted API, account system, or SLA.
Its assurance level is machine-readable: `db-reconstructive` first,
`node-attested` when local-node anchors pass, and `observer-attested` only when
an independent historical source exists.

Confirmed founder direction, 2026-08-11:

- No hosted-user migration or compatibility window.
- No service-level agreement. High internal quality bar and public evidence.
- Product de-hosting and infrastructure consolidation are separate decisions.
  Stop offering customer-facing hosted compute; keep current infrastructure.
- R2 is the public data edge; signed static status replaces a hosted status API.
- Every current chain-data capability remains included and runnable self-hosted:
  raw REST/SSE, decoded Index, Subgraphs, Subscriptions/webhooks, contract
  discovery, protocol datasets, local Explore/console, x402, verification, CLI,
  SDK, and MCP. Hosted accounts/billing are not retained.
- Legacy R2 datasets are deleted after `v1` acceptance and consumer cutover.
- Support external Stacks, bundled Stacks, and bundled Stacks + Bitcoin modes.

### Target topology

```text
SELF-HOSTED PRODUCT

official R2 archive ──bootstrap──┐
                                ▼
Stacks node ──observer──▶ Secondlayer ──▶ Postgres
                              │
                              ├── /v1/streams  raw reads
                              ├── /v1/index    decoded reads
                              ├── /v1/subgraphs
                              ├── subscriptions / webhooks
                              ├── contracts + protocol datasets
                              └── status / verify / repair

PRIVATE ARCHIVE INFRASTRUCTURE — RETAIN AS-IS FOR NOW

AX162-S: bitcoind ──▶ stacks-node ──observer──┐
                                              ▼
app server: API/indexer/decoders ─────────▶ Postgres + WAL/backups
                                              │ finalized ranges
                                              ▼
                                    signed Cloudflare R2 canonical archive

WAL/DB backup + observer journal ──rebuild──▶ R2
```

### Product boundaries

| Keep | Collapse | Remove |
| --- | --- | --- |
| Raw capture and canonical chain history | Index, Streams, and Subgraphs become capabilities of one product | Hosted accounts, sessions, projects, tenants |
| Decoded reads | API, indexer, decoder, and subgraph loops ship in one runtime image | Billing, Stripe, credits, usage metering |
| TypeScript subgraphs, reindex, repair | Public/private becomes local instance access | Hosted pricing, signup, and public directory authority |
| Subscriptions and signed webhook delivery | One local namespace and optional instance token | Redis, public hosted API, hosted commerce jobs |
| Contract discovery, protocol datasets, local discovery | Hosted Explore becomes a local catalog | Cross-instance social/discovery semantics |
| Operator-configured x402 | Operator owns recipients, assets, prices, and settlement policy | Secondlayer pricing/revenue authority |
| REST/OpenAPI contracts and minimal SDK/CLI | One database and one network per instance | Multi-tenant provisioning and managed status |
| Signed R2 canonical archive and private publisher | Existing publisher topology stays operational | Hosted decoded/subgraph products |

Keep `/v1/streams`, `/v1/index`, and `/v1/subgraphs` initially. Renaming public
routes is irreversible and provides little implementation savings. Stop
marketing them as separate products.

## Proposed developer experience

Commands below are the target contract, not current behavior.

```bash
# 1. Create a pinned deployment; emits the exact observer stanza
sl instance init --network mainnet --node-mode external \
  --node-rpc http://stacks-node:20443

# 2. Start every Secondlayer service; bootstrap mode durably spools live input
docker compose up -d

# 3. Install the emitted observer stanza, restart the node, prove callbacks/RPC
sl instance doctor

# 4. Import finalized envelopes while the live spool continues
sl instance bootstrap --archive official

# 5. Know exactly what is complete
sl status
sl verify all
sl verify all --deep --anchor node

# 6. Build an application index
sl subgraphs create activity
sl subgraphs deploy ./subgraphs/activity.ts

# 7. Query raw, decoded, subgraph, contract, and subscription surfaces locally
curl http://localhost:3800/v1/index/events?_limit=10
curl http://localhost:3800/v1/subgraphs/activity/events?_limit=10
```

Default install: operator-managed external Stacks node, `postgres` and
`secondlayer` containers, every runtime module enabled, loopback API, no token.
Compose profiles add a bundled Stacks node or bundled Stacks + Bitcoin. Public
binding requires an instance token or explicit reverse proxy configuration.

### Node modes

| Mode | Operator supplies | Secondlayer supplies | Integrity ceiling |
| --- | --- | --- | --- |
| `external` (recommended) | Synced Stacks observer/RPC; Bitcoin RPC for settlement | Runtime, Postgres, archive bootstrap | Live callback-log complete only with retry + durable ACK; history follows archive |
| `bundled-stacks` | Host/storage; optional Bitcoin RPC for settlement | Stacks node using supported public Bitcoin peer; runtime | Same live condition; settlement unavailable without Bitcoin RPC |
| `bundled-full` | Host/storage | Stacks node + pruned Bitcoin RPC + runtime | Full built-in inputs; strongest operational independence |
| `archive-only` | Nothing live | Read-only instance pinned to archive tip | Verified but not caught up; no live subscriptions/mempool |

`https://api.hiro.so` may be an explicit fallback for read-only contract calls,
RPC anchoring, and diagnostics. It cannot be the live ingest source because a
remote RPC URL cannot register callbacks to the operator's Secondlayer instance.
The local Stacks node RPC is the default whenever a live node exists.
`bundled-full` must bootstrap Stacks chainstate from a verified snapshot before
switching Bitcoin to pruning; its runbook must cover the pruned node's limited
historical-serving window and extended outages.

Stacks RPC/event delivery is enough for raw, decoded, contracts, Subgraphs, and
Subscriptions. `settle.sbtc.v1` additionally needs Bitcoin RPC. Without it the
service remains installed but reports `source_unavailable`; it never reports
complete. Our retained AX publisher uses its own Stacks + Bitcoin nodes.

### Existing implementation leverage and gaps

| Artifact/capability | Exists now | Required work |
| --- | --- | --- |
| Historical canonical data | Complete blocks/transactions/events in Postgres | Repeatable-read coverage audit, export, node anchors |
| Historical `/new_block` replay | `ArchiveReplayClient` can consume Hiro raw bodies | Optional assurance upgrade only; never a baseline dependency |
| Block/tx/event reconstruction | Parser + atomic persistence + reorg handling | Canonical R2 export and deterministic digests |
| R2 upload and Parquet | Streams bulk exporter/uploader | Global journal partitions; bounded streaming; new schemas |
| Signed manifests | ed25519 Streams manifests | Offline root/key registry; assurance ranges; atomic root |
| Finalized-range selection | Existing burn-confirmation range logic | Canonical lineage, deep-reorg supersession, signed head |
| Gap/integrity checks | Block continuity and broken-link checks | Exact path/native-clock coverage; source and stage receipts |
| `/new_burn_block` live parsing | Normalized reward/slot tables | Raw bytes, forks, global sequence, historical source/gap map |
| Contract registry | Live node ABI fetch + DB rows | Versioned contract source/ABI input receipts |
| sBTC settlement | Live Bitcoin RPC + DB rows | Versioned Bitcoin evidence receipts; dependency health |
| Observer durability | DB-backed exact receipt journal; routes retain raw bytes before parse | R2 journal export, replay/outbox/recovery |
| Independent attestation | None | Node auditor, witness, trust policy, signed reports |
| Transparent status/history | Partial local health | Signed R2 status, immutable reports/incidents, off-host checker |

Conclusion: current code supplies the parsers, persistence, reorg logic, R2
plumbing, signing primitives, an existing canonical Streams exporter, and a
usable historical `/new_block` importer. The first implementation slice now
retains exact observer bodies and processing receipts in the source database.
The canonical audit foundation is diagnostic until it receives an explicit
expected finalized upper bound; it does not emit a signed report or populate
the `v1` R2 tree yet. The next slice audits and exports our own canonical DB;
an external historical source is optional and only upgrades assurance.

## Archive contract

The existing `stacks-streams/mainnet/v0` archive is only a temporary comparison
source. After `v1` acceptance and internal consumer cutover, delete all legacy
prefixes. There is no public compatibility window because there are no users.

The authoritative `v1` archive starts from a repeatable-read canonical Postgres
snapshot, anchored to the local Stacks node where verified. It does not invent
historical observer bodies. Exact observer journal objects are a separate
dataset from journal activation onward:

```text
secondlayer/mainnet/canonical/v1/
├── latest.json                         signed root pointer
├── status.json                         signed/cache-short operational status
├── snapshots/<snapshot-digest>.json   signed immutable manifest
├── blocks/<range>-<digest>.parquet
├── transactions/<range>-<digest>.parquet
├── events/<range>-<digest>.parquet
├── journal/<seq-start>-<seq-end>-<digest>.jsonl.zst
├── head/<sequence>-<digest>.jsonl.zst  signed unfinalized observer tail
├── attestations/<snapshot>/<auditor>.json
├── reports/audits/<timestamp>-<digest>.json
├── reports/replays/<snapshot>-<runtime-digest>.json
├── reports/operations/<timestamp>-<digest>.json
├── incidents/<timestamp>-<digest>.md
└── keys/registry.json
```

Canonical objects preserve block/transaction/event identities, original ordering,
raw transaction data where stored, source snapshot metadata, and per-object
digests. Journal objects additionally preserve path, publisher-global sequence,
source id/version, receipt time, exact HTTP body bytes, raw-body SHA-256,
canonical semantic digest, and extracted block/burn identities. Exact bytes are
replay authority only for journal-covered ranges. Versioned semantic digests
permit comparison across JSON formatting and schema versions.

Persist full-genesis canonical blocks/transactions/events from our own DB when
coverage passes. Persist exact `/new_block` and `/new_burn_block` journal rows
from journal activation onward. An independent historical observer source is
optional; it upgrades a range to `observer-attested` but is not required for
the baseline archive. Mempool add/drop inputs remain a bounded rolling journal
with no historical completeness claim.

Each snapshot records network, schema/digest versions, genesis identity, archive
tip height/hash, source tip, finality rule, generation time, signer/key id, exact
height partitions, zero-record ranges, row counts, byte sizes, and SHA-256
digests. Every canonical height has exactly one canonical block record,
including zero-event blocks. Every transaction is present, including
transactions with zero events. Transactions and events retain original order
and parent identities. The manifest declares `assurance_ranges[]`, each keyed by
dataset/path, native clock, exact range, digest spec, source, auditor/key, and
level. Overall readiness is the minimum assurance required by enabled stages:

- `db-reconstructive`: canonical exports from one repeatable-read DB snapshot
  restore deterministically; this does not prove omitted historical callbacks.
- `node-attested`: canonical block/transaction/event digests also match the
  operator's independently synced local node for the supported range.
- `observer-attested`: digests match independently retained raw observer history.

Publish three separate results: canonical-chain completeness, delivered-callback
log completeness including forks/duplicates, and downstream-stage completeness.
Never collapse them into one green status.

Normalized indexes accelerate scans but are never the recovery authority. They
can be regenerated from canonical exports and journal rows. No full Postgres
dump, decoded table, subgraph table, or delivery history is required in R2. Those
are rebuilt locally. A
subscription created later does not retroactively emit webhooks unless the
operator explicitly requests a replay.

R2 `v1` starts canonical-first. Built-in stages that read outside canonical
chain data must create versioned local input receipts. Contract source/ABI reads
require Stacks RPC; sBTC settlement requires Bitcoin RPC. Arbitrary
user-subgraph chain reads remain instance-owned through height-pinned replay plus
local backup/effect receipts. `archive-only` cannot claim parity for those
stages or live side effects; a normal live self-host with the documented node
inputs can.

Files are content-addressed and append-only. `latest.json` changes only after
all referenced objects exist and the root signature verifies. A finality breach
creates replacement objects and a superseding signed snapshot; old snapshots
remain auditable. The signed head journal retains raw unfinalized observer
payloads and is pruned only after corresponding immutable ranges seal. Private
WAL recovery remains available through the publisher rollback window.

Official archive imports are strict by default: signature, schema, network,
genesis identity, checksums, range continuity, parent linkage, counts, and the
archive-to-node seam must pass before imported rows become trusted.

### Recovery authority

R2 is a public distribution copy, not the sole source of truth. Retain this
independent regeneration set while the current infrastructure remains:

1. Publisher Postgres plus WAL/physical backups for fast operational restore.
2. Exact live observer journal, fsynced before acknowledgement and backed up
   independently of R2.
3. Stacks and Bitcoin chainstate/RPC for semantic re-execution and anchoring.
4. R2 objects, manifests, and indexes as the cheap public bootstrap copy.
5. Optional independently captured observer source, mirrored with provenance,
   only when stronger historical callback assurance is needed.

The node alone is not assumed to reproduce exact historical callback bytes, and
the canonical DB is not treated as proof that callbacks were never omitted. An
R2-loss drill restores the DB/WAL snapshot, re-exports canonical objects, adds
journal objects from item 2, validates semantic digests against item 3, and
republishes R2. If an optional source exists, compare it as a separate audit.
Keep
at least three recoverable copies across two failure domains, with one off-host
and off-provider. No app-server or node cancellation is in this plan.

### Full backfill and verification flow

Baseline backfill uses our own canonical Postgres snapshot and the local Stacks
node. No Hiro download is required. An optional independently captured observer
source may later upgrade selected ranges to `observer-attested`; it is not a
runtime dependency or a prerequisite for publishing the canonical archive.

1. Run one repeatable-read DB audit from expected genesis through the finalized
   tip: prefix/suffix, gaps, ancestry, canonical counts, zero-event coverage,
   raw transaction coverage, and exact journal range. Sign the report as
   `db-reconstructive` and fail closed on continuity defects.
2. Stream that same snapshot into immutable canonical block, transaction, and
   event partitions. Preserve source snapshot id, row counts, ordering, and
   stable per-range digests; never claim exact historical callback bytes here.
3. Anchor canonical identities and semantic digests against the local Stacks
   node for empirically supported ranges. Publish `node-attested` only after
   throughput, height, fork, and mismatch behavior is measured.
4. If an independent observer source is available, mirror it with immutable
   provenance and compare path/native-clock ranges. Publish
   `observer-attested` only for ranges it actually covers; unsupported burn
   ranges and historical callback gaps remain explicit.
5. Start the local observer spool before any long import. Import the finalized
   canonical snapshot, then signed head, then locally spooled journal inputs,
   then enter live mode. Exact envelope replay claims start at journal activation.
6. Replay canonical partitions through Secondlayer into an empty database. Test
   RPC-dependent stages separately with pinned Stacks/Bitcoin inputs and local
   receipts; do not attribute those stages to R2 alone.
7. Run a second clean-room canonical replay from a separately built
   binary/database. Compare versioned range/final-state digests and preserve
   signed reference reports in R2 for future regression comparisons.
8. Publish `latest.json` only when the entire contiguous canonical range passes.
   Never advance it around a bad or missing partition.

### Transparent best-effort operation

No SLA. `status.json`, every signed snapshot, and `sl archive status` expose:
source/finalized/archive tips, expected finality lag, observed lag in blocks/time,
last successful publication, missing ranges, assurance level and audit coverage
by era, source/node versions, failed checks, and the last deep-verify report.
Internally alert against a founder-approved freshness objective. A stale or bad
archive stays visibly stale; the publisher never produces a falsely green tip.
Every audit, replay, failure interval, recovery, and incident also produces an
immutable signed report. An off-host scheduled checker verifies R2 independently
and appends public incident/recovery records; mutable status links to that history.

### Independent audit DX

Target commands; all return stable JSON and non-zero on an unaccepted gap:

```bash
# No trust in local DB; verify signatures, objects, continuity, and digests
sl archive verify official --deep

# Re-execute a supported path/range on an independently synced Stacks node
sl archive audit official --path new_block --clock stacks-height \
  --range 1..F --node http://localhost:20443

# Compare against a separately captured observer archive
sl archive audit official --path new_block --range 1..F \
  --observer-archive ./independent-events.zst

# Operate an independent prospective witness; command emits its observer stanza
sl archive witness init --network mainnet --output ./witness
sl archive witness serve --dir ./witness
sl archive witness report --snapshot <digest> --key auditor.key

# Publish a signed third-party attestation without modifying our archive
sl archive attest official --report audit.json --key auditor.key

# Require explicit path/range/trusted-key policy during bootstrap
sl instance bootstrap --archive official --assurance-policy ./policy.json
```

An attestation binds snapshot digest, auditor identity/key, source provenance,
node/core version, covered height ranges, digest-spec version, mismatches,
unsupported ranges, and timestamp. Byte-for-byte HTTP bodies prove capture
fidelity to one source. Versioned semantic digests compare independent nodes.
Operational independence requires a separately operated source; a second node on
the publisher host is useful differential testing but not an independent claim.
Historical observer-attested coverage is possible only where a second historical
raw capture exists or a separate node performs a fresh sync with capture. A
witness started today attests only its declared start onward. The archive must
show that limitation; it cannot promise retroactive full-genesis attestation.

## Integrity contract

Every instance declares an immutable scope:

```text
network + start_height + bootstrap provenance + current finalized target
```

`complete` means every unit in a stage's declared scope through its recorded
target was processed under a named code/config/handler version. It does not mean
the instance is current. `caught_up` additionally requires a fresh source tip
and complete coverage through the applicable finalized boundary.

Required states: `complete`, `syncing`, `lagging`, `gap`, `stale`, `failed`,
`unverified_import`, `unanchored`, `source_unavailable`, `out_of_scope`, and
`disabled`. Always expose `complete_through` separately from `source_tip`.

Coverage proves processing, not semantic correctness. Node anchoring proves
canonical identity where RPC permits, not that an observer omitted no payload.
A signature proves archive origin/integrity, not truth. Decoder fixtures,
differential replay, invariants, and optional independent-node comparison cover
those distinct claims.

Use one coverage kernel:

- `sync_scopes`: network, start, bootstrap source/manifest, genesis identity.
- `stage_registry`: stage, dependency, native clock, producer version, repair mode.
- `stage_runs`: code/config/handler hash, target, status.
- `stage_block_receipts`: block/hash, input count/digest, effect digest; atomic with output.
- `coverage_segments`: finalized compact ranges and chain/input/output digests.
- `stage_failures`: exact unit/range, class, retry state.

Observer envelopes are the raw receipts; canonical block rows reference their
envelope and semantic digests without duplicating bodies.
Every downstream block-clock stage acknowledges empty/no-match blocks. Queue
stages use accepted/decided/enqueued/delivered/dead counters and cursor fences.
Only finalized receipts compact. Reorgs invalidate overlapping receipts before
replacement processing.

Repair is conservative:

- Raw gaps require a trusted archive replay or resync; never fabricate payloads.
- Decoder gaps rewind to the first invalid receipt and replay raw input.
- Subgraph range repair requires proven `range_safe`; unknown means full reindex.
- Stateful handlers deep-verify by scratch replay and final-row digest.
- Every repair defaults to a dry-run plan; mutation requires `--apply`.
- Repair success requires a subsequent verifier pass.

## Permanent no-regression gate

1. Retained-route/OpenAPI allowlist and response fixtures.
2. Cursor, envelope, finality, reorg, replay, accumulator, and schema tests.
3. Golden corpus through real observer HTTP ingress: empty block, every event
   family, zero-event transaction, duplicate/out-of-order delivery, partial
   batch, shallow/deep reorg, missing height, bad parent, sparse and accumulator
   subgraphs.
4. Crash matrix at raw output, decoder output/checkpoint, subgraph
   output/checkpoint, receipt sealing, archive publish, and reorg rewind.
5. Old/new normalized response diff for every retained route.
6. Fresh install plus official-archive and from-genesis bootstrap paths.
7. Offline runtime smoke after images/archive inputs are present.
8. Seed one defect in every enabled stage; verification names the exact range
   and exits non-zero.

Existing cursors never prove historical completeness. Existing data enters as
`unverified_import` until deep audit or deterministic replay promotes it.

## Phase 0 — Approve the boundary

Goal: unchanged runnable system plus a signed product/architecture boundary.

- **P0.1 Target ADR.** Record one product, one-network instances, every current
  data/runtime service enabled, external Stacks default, bundled node profiles,
  R2-only public data edge, and canonical archive plus journal contract. Validate:
  founder approval;
  dependent tickets blocked on changes.
- **P0.2 Zero-user evidence.** Inventory accounts, keys, paid balances, private
  subgraphs, subscriptions, webhook targets, and authenticated/anonymous traffic.
  Validate: classify every row/request as internal, seed, bot, or external.
- **P0.3 REST manifest.** Classify every route retain/remove/internal and freeze
  retained OpenAPI/response fixtures. Validate: CI rejects unclassified routes.
- **P0.4 Client manifest.** Classify every CLI command, SDK export, and MCP tool.
  Validate: export/help snapshots detect omissions and additions.
- **P0.5 Runtime manifest.** Classify packages, entrypoints, tables, migrations,
  services, jobs, env vars, secrets, providers, and DNS records. Validate:
  import/schema/Compose/env scans agree with the manifest.
- **P0.6 Producer manifest.** Record each raw, decoded, registry, subgraph,
  notification, and archive producer with dependency, native clock, output,
  version source, and repair mode. Validate: every writer is classified.
- **P0.7 Baseline corpus.** Run the permanent corpus against the current hosted
  and OSS topologies. Validate: capture fixtures before behavior changes.
- **P0.8 Cost/resource baseline.** Capture invoices, containers, disk/RAM/CPU,
  DB/table sizes, R2 size/operations, ingest rates, archive lag, and restore time.
  Validate: reproducible dated report.
- **P0.9 Canonical DB coverage feasibility.** Run a repeatable-read audit from
  expected genesis through tip: prefix/suffix, gaps, ancestry, canonical counts,
  raw transaction coverage, and journal range. Validate: signed
  `db-reconstructive` report; optional external source remains a later assurance
  upgrade, not a baseline dependency.
- **P0.10 Archive RFC.** Freeze `v1` schemas, paths, signatures, finality,
  assurance levels, exact-body and semantic digest specs, supersession, zero-row
  partitions, importer promotion, public status, and legacy-prefix deletion.
  Validate: schema fixtures can represent every corpus case.
- **P0.11 Node-mode RFC.** Define `external`, `bundled-stacks`, `bundled-full`,
  and `archive-only`; exact observer/RPC wiring; Bitcoin trust; retry policy; and
  bootstrap prerequisites. Validate: config fixtures and support matrix.
- **P0.12 DX acceptance script.** Write black-box acceptance steps for init,
  bootstrap, status, verify, deploy, query, backup, restore, and upgrade.
  Validate: current failures are explicit; later phases turn them green.
- **P0.13 Source-of-truth rewrite.** Immediately after Gate A, update
  `STRATEGY.md` and `AGENTS.md` to define self-hosting plus the archive utility
  before archive or infrastructure changes land. Validate: no hosted taxonomy,
  pricing, process, or golden-path contradiction remains.
- **P0.14 Hosted-offer freeze.** After P0.13, remove signup/pricing/managed-service
  calls to action; disable new account/project creation and billable hosted jobs.
  Do not move, stop, or cancel the node, app server, databases, backups, or R2.
  Validate: no new hosted customer can enter; internal publishing remains green.

Demo: current software still runs; every retained and removed surface is visible.

**Approval gate A:** target product, archive promise/assurance level,
route/client manifests, zero-user evidence, and archive/node RFCs. P0.13 is the
first post-approval change; P0.14 follows it before Phase 1.

## Phase 1 — Full-genesis block archive and live journal

Goal: current infrastructure publishes a signed canonical `v1` archive plus an
exact observer journal from activation onward while the old deployment remains
the regression oracle.

- **P1.1 Raw scope migration.** Add network/genesis/start/provenance scope.
  Validate: fresh, imported, forward-only, and conflicting-network fixtures.
- **P1.2 Envelope contract.** Specify observer path, sequence, source/version,
  receipt time, exact body, raw digest, semantic digest, identities, and lineage.
  Validate: versioned vectors for every accepted callback and schema era.
- **P1.3 Durable ingress spool.** Before parsing, append and fsync the exact HTTP
  body plus metadata. During rollout, preserve the current atomic DB-before-200
  behavior and require both journal durability and DB commit before acknowledgement.
  Any later ACK-after-journal/async-processing change needs its own acceptance
  gate. Assert observer retries remain enabled; surface retry/ACK policy in
  doctor/status. Validate: kill at receive/fsync/parse/DB/upload/response.
- **P1.4 Observer route closure.** Classify `/new_block`, `/new_burn_block`,
  attachments, mempool add/drop, and any node-version path; reject unclassified
  state-affecting input. Validate: `events_keys=["*"]` route corpus.
- **P1.5 Canonical snapshot exporter.** Stream one repeatable-read Postgres
  snapshot into versioned canonical block/transaction/event partitions. Validate:
  bounded memory, row ordering, zero-row ranges, restart/resume, and provenance.
- **P1.6 Canonical digest/index builder.** Build stable per-height and
  per-partition digests/index rows from the canonical stream. Validate:
  byte-identical regeneration and count/digest agreement.
- **P1.7 Semantic digest specification.** Version canonical byte encodings for
  block/burn identity, ordered tx ids/raw/results, and ordered event identity/data.
  Validate: cross-runtime test vectors and property tests.
- **P1.8 Canonical invariant scanner.** Scan explicit `[genesis,F]` for missing
  prefix/suffix, ancestry, duplicates, zero-event blocks/txs, ordering, and
  conflicting canonical rows. Validate: every seeded defect is exact; do not
  infer omitted historical callbacks from this scan.
- **P1.9 Node replay auditor.** Adapt authenticated Stacks block replay into the
  semantic digest model for every empirically supported era. Never synthesize an
  observer body. Validate: version/era matrix, heavy block, timeout, bad auth,
  reorg, and unsupported responses.
- **P1.10 Canonical/finality builder.** Preserve all observed forks; select and
  seal canonical lineage only below the approved Bitcoin boundary. Validate:
  shallow/deep reorg and finalized-breach supersession.
- **P1.11 Canonical partition publisher.** Stream multipart uploads, make objects
  immutable/cache-forever, and resume from the first missing partition. Validate:
  low-memory, retry, collision, partial upload, and idempotency.
- **P1.12 Derived scan indexes.** Generate any lookup indexes solely from one
  canonical partition stream. Validate: indexes regenerate byte-identically and
  match canonical counts/digests, including empty cases.
- **P1.13 Snapshot manifest.** Build signed immutable manifests and atomic
  `latest.json`. Validate: missing object, wrong digest, bad signature, partial
  publish, or noncontiguous range never becomes latest.
- **P1.14 Signing trust root.** Pin an offline root key and root-signed online-key
  registry with rotation/retirement. Validate: active, rotated, retired, unknown,
  compromised, and lost-registry recovery fixtures.
- **P1.15 Transparent status.** Publish cache-short `status.json` from verified
  state only. Validate: fresh, expected-finality-lag, stale, gap, failed-audit,
  source-down, and key-rotation snapshots tell the truth.
- **P1.16 Archive importer.** Resume/idempotently replay canonical partitions and
  journal objects, atomically promote verified ranges, and record provenance. Validate: interrupt,
  duplicate, truncation, wrong network/genesis/schema, and fork conflict.
- **P1.17 Bootstrap live seam.** Start local spool first; import finalized
  canonical archive, signed head, and local spool in order; then switch to live
  processing. Validate:
  node advances throughout a multi-hour import with no omission/duplicate.
- **P1.18 Archive verification library.** Implement quick/deep signature,
  object, range, and digest checks with stable result codes. Validate: independent
  fault matrix.
- **P1.19 Archive verifier CLI.** Implement `sl verify archive [--deep]
  [--anchor node]`; keep `sl verify raw` as an explicit journal-era alias only
  while compatibility remains. Validate: offline says unanchored; stale/forked
  node never reports green.
- **P1.20 Genesis production build.** Build staging `v1` from a repeatable-read
  canonical DB snapshot, with local node anchor metadata and journal activation
  boundary. Validate: complete provenance and per-range assurance map.
- **P1.21 Independent node audit.** Benchmark node semantic comparison
  throughput/ETA and publish supported ranges, mismatches, and unsupported paths
  separately for blocks, transactions, and events. Validate: a seeded canonical
  mismatch is found; this is an assurance upgrade, not a baseline blocker.
- **P1.22 Optional observer audit.** If an independent historical observer source
  exists, compare each covered path/native-clock range and publish provenance,
  license, gaps, and unsupported burn ranges. A fresh-sync witness is usable only
  after proving stacks-core emits historical callbacks during sync. Validate:
  unattested ranges stay explicitly unattested.
- **P1.23 Clean-room canonical replay A.** Replay staging canonical partitions
  into an empty DB and verify canonical state, derived scan indexes, and retained
  raw routes. Validate: signed report with runtime/image/config/producer digests.
- **P1.24 Clean-room canonical replay B.** Repeat from a separate build and empty
  DB; compare versioned range/final-state digests and publish the signed accepted
  reference under `reports/replays/`. Validate: deterministic canonical rebuild.
- **P1.25 Derived-stage acceptance.** Test decoded families, each built-in
  contract/protocol producer, canonical sample subgraphs, and seeded subscription
  decision/outbox/retry/DLQ independently. Pin external RPC inputs and state what
  R2 alone cannot rebuild. Validate: one report per service; no vacuous pass.
- **P1.26 R2-loss drill.** Restore the off-provider DB/WAL snapshot, re-export
  canonical partitions, add the backed-up live journal, node-anchor semantic
  digests, regenerate derived objects, then compare manifests. Validate: R2 is
  not a circular dependency and corruption/loss is recoverable.
- **P1.27 Live append soak.** Publish signed head and finalized partitions for
  seven days. Validate: freshness objective, reorg, source restart, and manifest
  monotonicity; intentionally stale state remains explicit.
- **P1.28 Direct R2 discovery.** Publish CORS/range/cache-correct status, pointers,
  keys, manifests, objects, and attestations; point SDK/CLI directly to R2.
  Validate: API domain blocked, browser/CLI bootstrap, key rotation, range resume.

Demo: an empty database rebuilds genesis-to-finalized-tip from R2, consumes the
verified head path while the node advances, and joins live ingest with no gap.

**Approval gate B1 — usable archive:** canonical DB/node authority, two canonical
clean replays, proven archive/head/spool seam, transparent freshness,
off-provider DB/WAL/journal recovery, and successful R2-loss drill.

**Quality gate B2 — earned assurance:** node and observer attestations plus
service-specific reference reports publish by path/range as they pass. B2 is
required for the corresponding stronger claim, not for withdrawing the hosted
offering. The current app server remains part of the private publisher either way.

## Phase 2 — Withdraw the hosted offering; preserve infrastructure

Goal: Secondlayer is no longer offered as hosted compute. The current node, app
server, indexer, databases, backups, and R2 keep running privately and unchanged
except for the archive durability additions proven in Phase 1.

- **P2.1 Public dependency audit.** Re-run traffic/consumer inventory immediately
  before withdrawal. Validate: every caller is internal, seed, bot, or explicitly
  approved static-archive traffic; no customer migration remains.
- **P2.2 Freeze hosted mutations.** Disable account/project/key creation,
  hosted subgraph deploys, billing, metering, email, and commerce jobs. Preserve
  internal publisher jobs. Validate: deny matrix plus unchanged archive output.
- **P2.3 Public route decision.** Classify each hostname/path as static docs,
  direct R2, private internal, redirect, or gone. Validate: no customer-facing
  Index, Streams, Subgraphs, Subscriptions, control, or write endpoint remains.
- **P2.4 Positioning cutover.** Publish self-host-only product/docs/pricing copy
  and archive assurance language. Validate: content/link scan has no managed
  service, signup, SLA, or hosted key flow.
- **P2.5 Network isolation.** Remove public routing to compute while preserving
  the existing cross-host observer path. Stacks-core callbacks have no app auth
  header; secure that path with existing private networking, VPN, firewall, or
  constrained proxy—not an instance API token. Validate: external deny and
  node-to-indexer delivery/retry tests.
- **P2.6 Internal runtime allowlist.** Keep only private endpoints and jobs needed
  by live ingestion, decoding, archive production, verification, operations, and
  recovery. Validate: producer manifest maps every retained process and route.
- **P2.7 Public archive cutover.** Point docs/CLI/SDK bootstrap discovery directly
  to signed R2 roots. Validate: public API domain blocked while bootstrap,
  signatures, range requests, and status continue working.
- **P2.8 Hosted secret cleanup.** Rotate/remove only customer-facing billing,
  account, email, and public API credentials. Preserve node, DB, WAL, R2 writer,
  signing, monitoring, and recovery secrets. Validate: secret manifest review.
- **P2.9 Private recovery bundle.** Document the observer journal, DB/WAL
  backups, node chainstate, R2 copy, optional external source, owners, retention,
  and restore order. Validate: no recovery path relies only on R2 or only on node.
- **P2.10 Withdrawal drill.** Exercise public-route denial, internal publishing,
  R2 bootstrap, off-provider DB/WAL and journal restore, and rollback of routing
  only.
  Validate: no data movement, writer cutover, or provider cancellation occurs.
- **P2.11 Legacy R2 deletion.** After `v1` acceptance and every internal consumer
  cutover, delete deprecated prefixes and credentials. Validate: inventory and
  code/docs scans reference only deliberate `v1` and recovery objects.
- **P2.12 Infrastructure freeze.** Record the node/app-server topology and costs
  as accepted operational overhead. Any pruning, colocation, server shutdown,
  provider cancellation, DB move, or publisher-profile migration requires a new
  founder-approved plan. Validate: no such change appears in this workstream.

Demo: hosted compute endpoints are unavailable; self-host docs and R2 are public;
the existing private node → app-server → Postgres → R2 path stays green.

**Approval gate C:** zero-user recheck, hosted route/write withdrawal, direct R2
bootstrap, private publisher/recovery proof, and explicit no-infra-change audit.

## Phase 3 — Accountless self-hosted authority

Goal: current multi-process OSS deployment becomes a coherent local product
before process consolidation.

- **P3.1 Local instance identity.** Replace account ownership with one instance
  record and immutable network. Validate: no account row needed.
- **P3.2 Instance auth.** Use optional shared instance token; loopback is open,
  unauthenticated non-loopback bind is refused. Validate: bind/auth matrix.
- **P3.3 Local namespace.** Resolve subgraphs by unique local name; remove tenant,
  project, and visibility branches. Validate: deploy/read/delete without account.
- **P3.4 Local deploy gates.** Remove plan, trial, credit, hosted x402, quota,
  expiry, and ghost-account policy from deploy authorization. Validate:
  deploy/reindex/backfill from an empty DB without commerce state.
- **P3.5 Local x402.** Retain x402 as operator-owned optional payment gating;
  operator configures recipients, accepted assets, prices, and settlement policy.
  Remove Secondlayer revenue/pricing authority. Validate: off by default plus
  configured paid-call settlement with no account, Stripe, or platform DB.
- **P3.6 Local read path.** Remove usage writes, billing windows, product keys,
  and Redis rate limiting. Validate: retained read fixtures remain equivalent.
- **P3.7 Local subscriptions.** Remove account attribution; retain chain/table
  triggers, delivery formats, retry/DLQ/replay, HMAC, and ed25519 signing as a
  standard service. Validate: create, deliver, rollback,
  DLQ, replay with no account.
- **P3.8 One database.** Move retained raw, decoded, subgraph, notification, and
  coverage tables onto one connection path. Validate: atomicity, migration, and
  restore tests; exactly one runtime application DB URL.
- **P3.9 Retained route cleanup.** Remove hosted routes from the running app and
  regenerate OpenAPI. Validate: route manifest and 404 fixtures.
- **P3.10 CLI cleanup.** Add `sl instance init/bootstrap`; adapt status, verify,
  subgraph, subscription, and webhook commands; hide/remove login, account, billing,
  keys, projects, publish, and visibility flows. Validate: help snapshot and DX
  acceptance script.
- **P3.11 Node observer setup.** Generate and validate the exact Stacks observer
  stanza, callbacks, network, retry policy, transport isolation, and container-visible
  addresses for every node mode; refuse unsupported versions/configurations.
  Pure indexer nodes default to retrying delivery; signer-shared nodes surface the
  availability/completeness tradeoff and require a recovery source.
- **P3.12 Archive bootstrap seam.** Spool advancing observer inputs, import the
  official archive, consume the verified head/spool, then begin live tailing.
  Validate: gap, duplicate, wrong fork, stale archive, interrupted multi-hour
  import, and no request to `api.secondlayer.tools` after bootstrap.
- **P3.13 Default feature parity.** Start raw REST/SSE, Index, Subgraphs,
  Subscriptions/webhooks, contract discovery, protocol datasets, verification,
  and retained clients in the standard runtime; idle modules consume no work.
  Init generates and persists the shared encryption and webhook-signing keys; no
  unsigned production default. Validate: full manifest, secret-restart, and E2E corpus.
- **P3.14 Local console/catalog.** Adapt the current console and Explore into
  instance status, local subgraph discovery, subscriptions, and operator config;
  remove signup/pricing/public-directory assumptions. Validate: UI route corpus.
- **P3.15 Offline smoke.** Block Stripe, email, Redis, Slack, hosted API, and R2
  after bootstrap. Validate: ingest, decode, deploy, subscribe/deliver, contract
  discovery, protocol queries, reorg, and verification work.

Demo: a clean local instance bootstraps, verifies, deploys, and queries without
an account or Secondlayer runtime dependency.

**Approval gate D:** exact self-hosted commands, retained APIs, default profiles,
auth model, and fresh-install acceptance.

## Phase 4 — Full-stage coverage and safe repair

Goal: raw, decoded, subgraph, and delivery stages cannot silently skip work.

- **P4.1 Coverage schema.** Add registry, runs, receipts, segments, and failures
  with constraints and retention. Validate: migration and property tests.
- **P4.2 Coverage evaluator.** Resolve dependencies, native clocks, declared
  ranges, freshness, and state from one library. Validate: result snapshots.
- **P4.3 Runner state machine.** Standardize ordered acknowledgement, retry/halt,
  versioning, resume, and reorg invalidation. Validate: transition table.
- **P4.4 Decoder clock.** Pair Streams cursor ordering with canonical block/hash
  receipts, including no-match blocks. Validate: cursor/block seam corpus.
- **P4.5 Atomic decoder adapter.** Commit decoded output, checkpoint, receipt,
  and failure in one transaction. Validate: crash matrix.
- **P4.6 Generic decoders.** Adopt the adapter for STX, FT, NFT, print, and
  contract-call producers. Validate: existing corpus plus omission/version faults.
- **P4.7 Protocol decoders.** Adopt sBTC, PoX, and BNS individually. Validate:
  protocol fixtures, sparse history, and reorgs.
- **P4.8 Segment sealer.** Compact only finalized receipts after recomputing range
  digests. Validate: compaction crash or deep reorg never stays green.
- **P4.9 Bundler repair metadata.** Emit conservative `range_safe` or
  `full_reindex`; chain reads, accumulators, and unknown operations default full.
  Validate: source/AST operation matrix.
- **P4.10 Effect manifests.** Canonically hash ordered subgraph mutations per
  block. Validate: retry/equivalent runs are stable; historical defects differ.
- **P4.11 Atomic subgraph adapter.** Commit effects, rows, journal, cursor,
  receipt, and failure together for live/reindex/backfill paths. Validate: crash,
  duplicate, and concurrent-writer matrix.
- **P4.12 Sparse proofs.** Acknowledge skipped canonical ranges without handler
  execution. Validate: sparse and sequential chain/effect/final-row digests agree.
- **P4.13 Stateful deep verify.** Replay into a scratch schema and compare
  canonical final-row digest. Validate: seeded historical mutation is found.
- **P4.14 Queue coverage.** Cover subscription decision, outbox,
  delivery, rollback, DLQ, and replay with cursor fences. Validate: failure and
  dedupe matrix.
- **P4.15 Unified CLI/status.** Implement `sl verify all|raw|decode:<name>|subgraph:<name>`
  quick/deep/anchor/JSON and stable exit codes. Validate: library/CLI/REST parity.
- **P4.16 Repair planner/executor.** Produce dry-run plans; apply only registered
  safe modes; verify after mutation. Validate: unsafe ranges refused and each
  supported defect returns deep green.

Demo: seeded defects at every enabled stage are located exactly and repaired only
through an allowed strategy.

**Approval gate E:** semantics of complete/caught-up, stage inventory, performance,
and corruption/recovery acceptance.

## Phase 5 — One-box distribution

Goal: default self-host installation is Postgres plus one Secondlayer container.

- **P5.1 Lifecycle modules.** Give API, ingest, decoder, subgraph, notification,
  verification, and publisher modules explicit start/stop/health. Validate:
  isolated restart tests.
- **P5.2 Unified supervisor.** Start selected profile modules, contain loop
  failures, and aggregate health. Validate: fault each module; unrelated reads
  remain available and status degrades honestly.
- **P5.3 Handler isolation.** Run untrusted subgraph handlers in worker processes
  with timeout/resource/network controls. Validate: infinite loop, memory, throw,
  and process-kill fixtures cannot kill ingest/API.
- **P5.4 Embedded migration.** Run advisory-locked migrations before listeners
  and workers. Validate: concurrent startup and failed migration.
- **P5.5 Single image.** Build one signed multi-arch self-host runtime image.
  Keep the current internal publisher deployment separate. Validate: amd64/arm64
  corpus smoke with no private-infrastructure dependency.
- **P5.6 Minimal Compose.** Default `postgres` + `secondlayer` with all runtime
  services; optional `stacks-node` and `full-node` profiles. Validate: external,
  bundled Stacks/public-Bitcoin, and bundled Stacks/pruned-Bitcoin ordering.
- **P5.7 Minimal config.** Target six required non-secret values or fewer; reject
  unknown/contradictory values before ingest. Validate: config matrix.
- **P5.8 Status UX.** Report node, raw, decoder, subgraph, queue, archive import,
  disk, and coverage states with actions. Validate: snapshots for all states.
- **P5.9 Backup bundle.** Export consistent DB, pinned config, encrypted key
  material, handler manifests, and scope. Validate: wiped-host restore deep-green.
- **P5.10 Upgrade contract.** Pin images, preflight schema/disk, backup first,
  migrate, health/verify, and document rollback limits. Validate: supported-version matrix.
- **P5.11 Resource guardrails.** Preflight RAM/disk/Postgres settings and estimate
  growth/exhaustion. Validate: constrained fixtures fail early and clearly.
- **P5.12 Distribution docs.** One quickstart, architecture, archive/bootstrap,
  verification/repair, backup/restore, upgrade, security, and troubleshooting path.
  Validate: every documented command runs in CI.

Demo: clean machine to decoded query and deployed subgraph through the proposed DX;
`sl verify all` is green.

**Approval gate F:** release packaging, image/profile contract, upgrade/backup UX,
and documentation acceptance.

## Phase 6 — Delete hosted authority and dead surface

Goal: repository and deployments describe only self-hosting plus the raw publisher.

- **P6.1 Account/auth deletion.** Delete magic links, sessions, claims, account
  keys, account CLI, and dashboard auth. Validate: import/route/export scans.
- **P6.2 Billing deletion.** Delete plans, Stripe, credits, spend caps, x402,
  metering, quotas, and platform pricing middleware; retain extracted local x402.
  Validate: dependency/schema scans and x402 isolation tests.
- **P6.3 Tenant/project deletion.** Delete tenants, projects, teams, visibility,
  public-name allocation, and provisioning. Validate: local namespace corpus.
- **P6.4 Hosted worker deletion.** Delete ghost, metering, reconcile, alert, and
  expiry jobs plus worker package if empty. Validate: workspace/entrypoint scan.
- **P6.5 Platform package deletion.** Move any retained neutral helpers, then
  delete `packages/platform`. Validate: clean dependency graph.
- **P6.6 Control-schema deletion.** Drop only tables classified remove; archive
  historical migrations outside fresh runtime. Validate: clean baseline equals
  upgraded verified schema.
- **P6.7 Web application simplification.** Retain the local console/catalog
  and static docs; remove pricing, signup, hosted status, cross-instance Explore,
  and hosted product claims. Validate: route/link/content manifest.
- **P6.8 Client pruning.** Keep approved CLI/SDK capabilities; remove account,
  billing, hosted URL, and visibility contracts; retain MCP. Validate:
  export/help/docs manifests.
- **P6.9 Internal protocol extraction.** Ensure decoders use internal Streams
  primitives rather than the public SDK. Validate: import graph and decoder build.
- **P6.10 Deployment isolation.** Make self-host Compose/images independent of
  the hosted-era topology. Keep current private app-server/node deployment
  manifests in an internal operations boundary until a separate migration is
  approved. Validate: self-host releases have no runtime dependency on them.
- **P6.11 R2 isolation.** Keep publisher/archive code in a small module/profile;
  self-host runtime treats R2 only as optional bootstrap input. Validate: offline
  runtime and publisher-only dependency graphs.
- **P6.12 Frozen periphery.** Extract or delete stacks wallet/Clarity tooling,
  BYO/multi-ORM paths, and dead examples according to the approved manifest.
  Validate: maintained core build and examples.

Demo: repository search finds no hosted authority; only the self-host runtime and
canonical archive publisher remain.

**Approval gate G:** deletion manifest reviewed before destructive schema, secret,
provider, or package removal.

## Phase 7 — Self-host 1.0 hardening

Goal: a recoverable release operators can trust without Secondlayer compute.

- **P7.1 Seven-day soak.** Run every supported deployment/profile under target
  resources. Validate: no unexplained coverage transition or process restart.
- **P7.2 Bootstrap matrix.** Test official archive, from-genesis, forward-only,
  external node, and bundled node where supported. Validate: honest scope states.
- **P7.3 Upgrade matrix.** Upgrade from every supported self-host version and
  restore backup. Validate: data and coverage digests remain stable.
- **P7.4 Corruption drills.** Missing block, broken ancestry, stale decoder,
  handler change, partial restore, full disk, killed migration, bad archive,
  signing-key rotation, and deep reorg. Validate: detect and recover to deep green.
- **P7.5 Performance gates.** Measure import, catch-up, decode, subgraph replay,
  quick/deep verification, DB growth, and API latency. Validate: publish limits
  and capacity guidance.
- **P7.6 Security pass.** Threat-model observer ingress, API exposure, handler
  isolation, webhook egress, secrets, archive signing, images, and backups.
  Validate: high findings closed or accepted explicitly.
- **P7.7 Reproducible release.** Pin dependencies/images, generate SBOM and
  checksums, sign artifacts, and verify on a clean builder. Validate: matching build.
- **P7.8 1.0 acceptance.** Exercise install, bootstrap, reorg, deploy, repair,
  backup/restore, upgrade, and uninstall-with-data-preservation. Validate: signed
  acceptance report.

Demo: release candidate survives corruption and restore while proving every
configured finalized height.

**Approval gate H:** self-host 1.0 release.

## Sequence

1. Approve Phase 0 before changing public positioning.
2. Rewrite `STRATEGY.md`/`AGENTS.md` immediately after Gate A.
3. Make the R2 canonical archive and journal-era exact inputs independently
   rebuildable in Phase 1; publish stronger audit claims only as each path/range
   earns them.
4. Withdraw hosted compute in Phase 2 without moving or cancelling infrastructure.
5. Establish accountless behavior before process consolidation.
6. Land coverage before claiming verified self-hosting or deleting old paths.
7. Consolidate distribution, then delete hosted authority.
8. Call it 1.0 only after the hardening matrix.

Stop any phase that cannot answer: what exact range is complete, against which
canonical chain, under which code/config/handler version, from which provenance?

## Success measures

- Recurring operated infrastructure: current node, app server, databases,
  backups, and R2 retained; cost reduction is not a success criterion yet.
- Public Secondlayer compute/API endpoints: zero; static docs and R2 remain.
- Private publisher: current topology remains green and externally unreachable.
- Default self-host containers: two (`postgres`, runtime) plus operator's node.
- Default self-host required non-secret config: six values or fewer.
- Full-genesis canonical blocks/transactions/events rebuild product data. Exact
  observer envelopes rebuild observer-derived state from journal activation
  onward. RPC-dependent and side-effecting stages declare their additional local
  inputs; per-era/path assurance and unsupported ranges are public.
- Empty DB restores from R2, joins the node at one verified seam, and catches up.
- No account/signup/billing/project concept in install, CLI, API, schema, or docs.
- Every current chain-data feature/service is runnable in the default image.
- Every enabled stage exposes declared/covered/target/source ranges and exact gaps.
- Every seeded defect is detected; unsafe repair is refused.
- Retained response/cursor/reorg fixtures remain equivalent.
- Backup, restore, upgrade, and deep verification require no Secondlayer-operated compute.

## Unresolved founder approvals

1. What internal archive freshness alert target should back the no-SLA promise?
2. Exact finality rule: six Bitcoin confirmations or another boundary?
3. Is seven days enough for archive and release burn-ins?
4. Must observer-attested status require a third-party signature, or may a
   separately operated founder-controlled verifier qualify initially?
5. MIT/community support, paid support, or another licensing/support boundary?

# @secondlayer/indexer

## 1.12.5

### Patch Changes

- a063b26: Remove the platform's Hiro reliance. The integrity auto-backfill no longer falls back to Hiro's public API for gaps the own DB can't replay (Phase 1 own-stacks-node DB replay stays; unfillable gaps now alert loudly instead of silently calling `api.mainnet.hiro.so`) — the running plane is now Hiro-free. Drop the `api.hiro.so` default from the opt-in `parser.ts` tx-decode fallback (now no-ops unless explicitly pointed at a source), the legacy `HIRO_API_KEY` env fallback in `sl generate` / `sl subgraphs`, the vestigial blank `HIRO_*` env on the api service, and three zero-importer dead `stacks-api*` codegen files (legacy `stacks-node-api.*.stacks.co` URLs). Fix the false `.env.example` "polls Hiro" comment. (Hiro remains only in manual backfill/repair scripts, which aren't running services.)
- c2e4caa: Fix the Streams read-path hot spot. Add chain-plane indexes on `events` for the firehose payload filters — `(block_height, type)` plus partial expression indexes on `data->>'sender'`, `data->>'recipient'`, and `data->>'asset_identifier'` (partial `IS NOT NULL` so an equality filter provably uses them regardless of `types=`). Replace the per-row correlated `COUNT(*)` that computed each event's per-block `stream_event_index` (O(rows × block_events) across all four Streams read paths) with a single `ROW_NUMBER()` window over the block's all-types event set — byte-identical ordinals, so the cursor-stability contract (an event's `stream_event_index` is the same with or without filters) is preserved and now covered by a dedicated test. Build the indexes with `CREATE INDEX CONCURRENTLY` in prod before deploy (the migration is `IF NOT EXISTS` no-op there).
- Updated dependencies [c2e4caa]
  - @secondlayer/shared@6.28.1

## 1.12.4

### Patch Changes

- 201b630: `getEnabledL2DecoderNames` now reads pox4 from its injected `env` argument (mirroring sbtc/bns) instead of global `process.env`, so the enabled-decoder view is consistent and testable. Production behavior is unchanged (pox4 still default-on, opt-out via `POX4_DECODER_ENABLED=false`).
- Updated dependencies [1c99bd0]
- Updated dependencies [bbd40f7]
  - @secondlayer/sdk@6.16.0
  - @secondlayer/shared@6.27.0

## 1.12.3

### Patch Changes

- e9d4594: Re-source the PoX-4 stacking decoder over the public Index HTTP API (removing its source-DB coupling), serve burn_block_height on /v1/index/transactions, and enable the stacking decoder by default (set POX4_DECODER_ENABLED=false to opt out; POX4_BACKFILL_FROM_HEIGHT bounds the backfill scan)
- 0865ca2: Fix reorg orphaned_to cursor undercounting contract_event prints on post-rename blocks by single-sourcing the firehose event-type vocab
- cc75ef3: Single-source the firehose DB event-type vocab (STREAMS_DB_EVENT_TYPES + label maps) in @secondlayer/shared; indexer consumes it instead of a local copy
- Updated dependencies [173340a]
- Updated dependencies [e9d4594]
- Updated dependencies [cc75ef3]
- Updated dependencies [6b11c2a]
  - @secondlayer/shared@6.19.0

## 1.12.2

### Patch Changes

- 80433eb: Consolidate the decoded event-type vocabulary into a single `@secondlayer/shared` source (`DECODED_EVENT_TYPES`, `STREAMS_EVENT_TYPES`, and the now-exported `CHAIN_TRIGGER_TYPES`), replacing the duplicate literal copies in the SDK, indexer, and MCP tools. The MCP context resource now generates its `whatYouCanDo` capability list from the live tool registry, so it can no longer drift behind the actual tool surface.
- Updated dependencies [a777de7]
- Updated dependencies [80433eb]
- Updated dependencies [e0f9499]
- Updated dependencies [a9be0a3]
- Updated dependencies [22725d0]
  - @secondlayer/sdk@6.9.0
  - @secondlayer/shared@6.18.0

## 1.12.1

### Patch Changes

- 756b5c9: Keep mempool txs the node drops as `StaleGarbageCollect` (its own memory-pressure GC) instead of hard-deleting them — one node's aggressive GC was draining the mempool to near-empty. Genuine drops (RBF, replace-across-fork, problematic) are still honored; stale-GC'd txs clear via eviction-on-confirmation or the retention sweep.
- eb28345: Let the mempool table accumulate to a useful depth instead of capping near-empty. The retention sweep is a backstop (confirm + genuine-drop are the primary eviction), so its default window goes 24h → 72h (still `MEMPOOL_RETENTION_HOURS`-tunable) — past the node's own GC horizon — and the leader-gated sweep now logs `mempool depth` at info level so accumulation is observable in prod.
- Updated dependencies:
  - @secondlayer/sdk@6.5.0

## 1.12.0

### Minor Changes

- 4b96a8a: Add mempool (pending transactions) to the Index API.

  The indexer now persists unconfirmed transactions from the Stacks node's `/new_mempool_tx` observer callback (deriving the txid from raw_tx), evicts them on confirmation (block ingest) or drop (`/drop_mempool_tx`), and sweeps stuck rows. The Index API serves them at `GET /v1/index/mempool` (filter by `sender`/`type`, cursor-paginated) and `GET /v1/index/mempool/:tx_id` — full pending-transaction documents (fee/nonce/post-conditions decoded from raw_tx), minus the block-anchored fields, plus `received_at`. Mempool reads are never cacheable (volatile). New SDK client: `index.mempool` (`list`/`walk`/`get`).

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@6.4.0
  - @secondlayer/shared@6.14.0

## 1.11.0

### Minor Changes

- 982f2bb: Add a wrong/empty Postgres volume guard. `checkChainDataIntegrity` flags the case where the chain tip is high but the deep history it implies is missing — the signature of a container recreated against a fresh/empty data dir. The indexer logs a loud `DB INTEGRITY ALERT` on startup (fail-closed with `REQUIRE_INTEGRITY=true`), and `/public/status` now reports `chainIntegrity` and degrades the top-level status on failure (without marking a core service down). Closes the blind spot where the DB read "healthy" on freshness while serving an empty volume.

### Patch Changes

- d5471e8: Consolidate the duplicated dataset row-normalization helpers (`nullableInt` and the TIMESTAMPTZ→ISO `block_time` coercion) into `datasets/_shared/row.ts`, replacing per-query copies across the pox-4, sBTC, and BNS dataset queries. No behavior change.
- 73d12c4: pox-4 calls and BNS name/namespace/marketplace dataset exports now filter `canonical = true`, matching the sBTC/stx datasets; previously fork-side rows left behind by the mark-non-canonical-in-place reorg model leaked into the published Parquet datasets.
- Updated dependencies:
  - @secondlayer/sdk@6.1.0
  - @secondlayer/shared@6.13.0

## 1.10.0

### Minor Changes

- 655db50: Add exclusion and multi-value filters to the Streams events firehose. `not_types` excludes event types, and `contract_id`, `sender`, and `recipient` now accept comma-separated lists (matching any value). Exposed on `GET /v1/streams/events`, the SDK (`events.list/consume/stream` accept `notTypes` and `string | string[]` filters), and the `sl streams events`/`consume` CLI (`--not-types`, `--sender`, `--recipient`, comma lists on `--contract-id`).

  No new indexes: `not_types` narrows the existing `type IN (...)` set and the list filters reuse the same range-bounded `events.data` access path as the single-value filters, so the query plan is unchanged.

- a930331: Add opt-in payload validation with a dead-letter log on ingest. When `STREAMS_PAYLOAD_VALIDATION=true` (default off), each event's decoded payload is checked against the minimal shape its type requires; malformed payloads are recorded in a new `dead_letter_events` table (migration 0085) with a reason. The event itself is still persisted — chain data is never dropped — so this is a diagnostic log, not a gate. Default-off keeps the ingest hot path lean.

### Patch Changes

- d738192: Harden leader election against split-brain on connection reset. The heartbeat now verifies the advisory lock is still held by the current backend (via `pg_locks`) instead of a plain `SELECT 1`, so a transparent driver reconnect — which silently drops the session-scoped lock — is detected within one heartbeat and the instance relinquishes, instead of two instances both believing they're leader.
- 8f129ab: Align the Streams bulk-dump publisher with the burn-confirmation finality boundary used by the Streams read path. The publisher now derives the finalized range from `finalizedBurnHeight` → `getFinalizedStacksHeight` (BTC confirmations, default 6) instead of the legacy 144-Stacks-block lag, so dumps and live reads agree on what is final. Replaces the `STREAMS_BULK_FINALITY_LAG_BLOCKS` env (now ignored on the streams path) with `STREAMS_BULK_BTC_CONFIRMATIONS`. The dataset exporters are unchanged.
- Updated dependencies:
  - @secondlayer/sdk@6.0.0
  - @secondlayer/shared@6.12.0

## 1.9.0

### Minor Changes

- 54de9cd: Extract block ingestion into an in-process `ingestNewBlock` (new `ingest.ts`). The tip-follower and auto-backfill now ingest directly instead of self-POSTing to `localhost:PORT/new_block`, which was wrong behind a load balancer and a single point of failure. The HTTP `/new_block` route is now a thin wrapper. Prep for running multiple indexer instances.
- 4607d53: Gate the singleton background loops (integrity, tip-follower, all dataset publishers, contract registry) behind leader election. Opt-in via `INDEXER_LEADER_ELECTION=true`: exactly one instance runs the loops while the HTTP ingest server runs on every instance, making it safe to run multiple indexers. Default off preserves single-instance behavior.
- e9401ee: Add a Postgres advisory-lock leader-election primitive (`withLeaderLock`). Exactly one indexer process holds the lock (on a dedicated long-lived connection) and runs leader-only work; standbys poll and take over if the leader exits or its connection dies. Backend is injectable for testing.
- 0fab6c1: Preserve reorged rows instead of destroying them. On a reorg that reuses a height with a new block hash, the indexer now copies the orphaned transactions/events into new `transactions_archive` / `events_archive` tables (migration 0084) before replacing the height, tagged with the displaced block hash. The main tables stay canonical-only so all readers are unaffected, while the raw log is preserved and queryable — honoring the immutable-log guarantee. A redelivery of the same block is not a reorg and is not archived.
- c8e7c41: Add burn-block-anchored finality helpers. `@secondlayer/shared` exposes `DEFAULT_BTC_CONFIRMATIONS` + `finalizedBurnHeight()`, and the indexer adds `getFinalizedStacksHeight()` to map the burn-confirmation boundary to the highest finalized Stacks height. Post-Nakamoto finality is anchored to Bitcoin confirmations rather than a fixed Stacks-block lag.
- 48a8b08: Streams events now support `sender`, `recipient`, and `asset_identifier` filters on `/v1/streams/events` (and the SDK `events.list`/`consume`/`stream`), matching Index's principal/asset filters. They apply as exact-match predicates on the raw event payload, so event types lacking the field simply don't match — the firehose narrows naturally. Closes the query-parity gap with Index.

### Patch Changes

- bfa74db: Centralize the Streams cursor codec in `@secondlayer/shared` (`encodeStreamsCursor`, `decodeStreamsCursor`, `EMPTY_RANGE_EVENT_INDEX_SENTINEL`). The API and indexer now delegate to one implementation instead of three near-identical copies, so encode/decode and the empty-range sentinel can't drift between products.
- Updated dependencies:
  - @secondlayer/sdk@5.9.0
  - @secondlayer/shared@6.11.0

## 1.8.0

### Minor Changes

- 74c59ab: Ingest replaces transactions/events per block height. The `new_block` handler now deletes existing `transactions`/`events` at the block height before re-inserting (extracted into a testable `persistBlock()`), so a reorged height no longer accumulates orphaned duplicate `(block_height, tx_index)` rows — the upstream cause of the Streams cursor collisions that wedged the L2 decoders (#46). The cursor-dedupe in `writeDecodedEvents` stays as defense-in-depth.

### Patch Changes

- f195618: Fix L2 decoder wedge: de-dupe decoded events by cursor before the upsert. A reorged height with stale duplicate transactions can produce two events sharing one Streams cursor in a single batch, which fails the `decoded_events` ON CONFLICT upsert ("cannot affect row a second time") and loops the decoder indefinitely. `writeDecodedEvents` now keeps the last occurrence per cursor.

## 1.7.0

### Minor Changes

- 4657c71: Index now serves `stx_lock` (stacking lock) events via `GET /v1/index/events?event_type=stx_lock`. The locked principal maps to `sender`, the locked uSTX to `amount`, and `unlock_height` rides in `payload` (`{ unlock_height }`) — filterable by `sender`. SDK adds `decodeStxLock` / `isStxLock` + `DecodedStxLock` types and the `IndexStxLock` client variant. No migration: reuses the existing `decoded_events.payload` jsonb column.

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.5.0

## 1.6.0

### Minor Changes

- 81fc2d8: Index now decodes and serves Clarity `print` events. `GET /v1/index/events?event_type=print` returns each print's `topic`, the Clarity `value` decoded to JSON (uints as strings, buffers as `0x…` hex, tuples as objects), and the canonical `raw_value` hex — filterable by `contract_id`.

  SDK adds `decodePrint` / `isPrint` and the `DecodedPrint` types (depends on `@secondlayer/stacks` for Clarity decoding). A nullable `payload` JSONB column is added to `decoded_events` to hold decoded values that don't fit the flat transfer columns. The indexer runs a `print` decoder; the API registry and OpenAPI expose it.

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.2.0
  - @secondlayer/shared@6.8.0

## 1.5.0

### Minor Changes

- 239e2f2: Index now decodes and serves STX transfers, mints, and burns for tokens. `GET /v1/index/events` accepts `event_type` of `stx_transfer`, `stx_mint`, `stx_burn`, `ft_mint`, `ft_burn`, `nft_mint`, and `nft_burn` alongside the existing transfer types.

  SDK adds `decodeStxTransfer`, `decodeStxMint`, `decodeStxBurn`, `decodeFtMint`, `decodeFtBurn`, `decodeNftMint`, `decodeNftBurn` (plus their decoded types, `is*` guards, and the `DecodedEventColumns` helper) and widens `DecodedEventRow` to the full set. The indexer runs a decoder per new type; the API registry and OpenAPI expose them with per-type filters.

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.1.0

## 1.4.3

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.0.0

## 1.4.2

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@4.0.0

## 1.4.1

### Patch Changes

- 3f81aa6: Datasets publisher now writes `latest.json` to the family-root alias path (`<prefix>/<dataset>/latest.json`) in addition to `<prefix>/<dataset>/manifest/latest.json`. Quickstart snippets that say "latest.json per family" — the intuitive URL — now work without rewriting docs. Marketing parquet snippet (`apps/web` parquet-snippet component) updated to a manifest-based DuckDB query (recommended, no LIST permission needed) plus a glob fallback with `SET allow_asterisks_in_http_paths = true`; the previously documented glob-only quickstart failed on the R2 dev domain.
- d1ea07b: Publisher now refreshes `latest.json` on every tick — even when the latest finalized range's parquet already exists in R2. Previously `latest.json` only updated when a new parquet was written, so it drifted behind reality for families with no new data (showed an older range despite recent parquets being live in R2). New `manifestOnly` mode in `exportDatasetRange` re-derives the manifest locally and uploads only the JSON; the byte-identical existing parquet stays in place.
- 3da36df: Reorg + data model polish:

  - Streams event rows now include `canonical: true` so clients can write type-safe reorg-aware code. (Field is optional in the SDK type to preserve backwards compatibility.)
  - Index `/v1/index/ft-transfers` and `/v1/index/nft-transfers` row projections now include `block_time` (ISO 8601 UTC, sourced via subquery on the canonical block).
  - Streams cursor-less default window tightened from `tip - 1 day` (~17280 blocks) to `tip - 1000 blocks` (~80 min) so first-touch responses surface recent data instead of stale events ~17k blocks behind tip. Indexer-style backfill consumers should pass `from_height=0` or an explicit cursor as before.
  - `microblock_hash` field on events deferred — requires a `blocks` table schema change; tracked separately.

- Updated dependencies:
  - @secondlayer/shared@6.4.1

## 1.4.0

### Minor Changes

- 6ec2143: Add parquet exporters for `pox-4/calls`, `bns/name-events`, `bns/namespace-events`, `bns/marketplace-events`. Each ships behind its own `*_PUBLISHER_ENABLED` flag (no auto-on). Register the four new slugs in the `/v1/datasets/*` manifest map.

  Refactors: extract `datasets/_shared/exporter.ts`, `scheduler.ts`, `parquet.ts` so adding new families is now a ~5-file, column-driven addition rather than a copy-paste of the sBTC pattern. Existing sBTC + STX-transfers families switched to the shared factories; output byte-identical.

  Add `bun run --filter @secondlayer/indexer datasets:backfill <slug> --from <block> --to <block>` to walk historical ranges and upload.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.4.0

## 1.3.13

### Patch Changes

- 7b43cb3: loosen `nearTip` threshold from 60s → 300s. Under the AND-with-OR health logic shipped same-cycle, a sparse-but-keeping-up decoder (sBTC, BNS-V2 during quiet windows) would falsely flag unhealthy any time its checkpoint drifted more than a few blocks behind tip while no events matched its filter. 5 min tolerates normal block-time variance + sparse-event arrival without masking truly stuck decoders, which sit hours behind tip.

## 1.3.12

### Patch Changes

- aac8f1f: fix two L2 decoder health bugs that surfaced during the 2026-05-12 BNS backfill experiment.

  (1) `getL2DecoderHealth` reported `status: ok` for decoders stuck in error-retry loops. The `runDecoder` `finally` block bumps `checkpoint.updated_at` every iteration as a liveness ping — `checkpointRecent` was true even when the decoder was failing every fetch. Treated heartbeat as sufficient. Now treat it as necessary: status is healthy only when the heartbeat is recent AND there's a real-work signal (`nearTip` or `writesRecent`). Decoder stuck mid-history with no writes now correctly reports unhealthy in ~5 min instead of forever.

  (2) `lag_seconds` returned ~1.78B (~56 years) when checkpoint moves backwards onto a block whose row in the `blocks` table has `timestamp = 0` (a historical bulk-import artifact). Added a defensive `timestamp > 0` guard; returns `null` for the unmeasurable case, matching the existing "no checkpoint yet" shape that dashboards already handle.

- Updated dependencies:
  - @secondlayer/sdk@3.5.4

## 1.3.11

### Patch Changes

- d14b6b5: default sbtc decoder to enabled — flip `SBTC_DECODER_ENABLED` from opt-in (`=== 'true'`) to opt-out (`!== 'false'`) and bump docker-compose default to `:-true`. The `/v1/datasets/sbtc/events` endpoint is public, so the decoder that fills it ships on by default. OSS users on chains without sBTC can still disable with `SBTC_DECODER_ENABLED=false`.
- 321ebca: split sbtc decoder into registry + token, narrow filter to avoid socket timeouts

  `l2.sbtc.v1` previously fetched `print` + `ft_transfer/mint/burn` events across all contracts with `batchSize: 500` and no server-side filter, mirroring the unfiltered scan bug BNS already fixed — the upstream socket closes mid-response on long-running historical scans. Split into two decoders backed by one source file:

  - `l2.sbtc.v1` — registry `print` events on `<network>.sbtc-registry`, writes `sbtc_events`
  - `l2.sbtc_token.v1` (new checkpoint) — `ft_transfer/mint/burn` on `<network>.sbtc-token`, writes `sbtc_token_events`

  Each uses `batchSize: 100` and a server-side `contractId` filter selected via `STACKS_NETWORK`. `/public/status` reports both via `status.ts` mapping. `getEnabledL2DecoderNames` and the health-module `readLatestDecodedAt` switch surface the new decoder too. Existing `l2.sbtc.v1` checkpoint preserved.

- Updated dependencies:
  - @secondlayer/sdk@3.5.2

## 1.3.10

### Patch Changes

- 7f4a5a2: cap empty-range cursor sentinel at int4 max so the next fetch doesn't 500

  The earlier sentinel `Number.MAX_SAFE_INTEGER` overflowed Postgres `integer` (int4) when used as a query parameter against `stream_event_index`, so the very fetch that was supposed to advance past an empty filtered range threw `value "9007199254740991" is out of range for type integer` and pinned the decoder.

- 55848a6: fix decoder freeze when server-side filter eliminates every event in scanned range

  `readCanonicalStreamsEvents` advances `next_cursor` past `toHeight` instead of returning `null` for empty filtered scans — fixes BNS/FT decoders that pinned at previous cursor and spun forever in `consume()`.

  `runDecoder` passes `maxEmptyPolls: 1` so `consume()` returns periodically and the liveness ping keeps `l2_decoder_checkpoints.updated_at` fresh.

  Status route drops unimplemented `reorgs.last_24h`.

- ed100d3: fix nft decoder default to apply server-side types filter

  `consumeNftTransferDecodedEvents` was passing `types: opts?.types` (undefined by default), so the streams query scanned every event type in the cursor range and timed out the API on big backlogs — leaving the NFT decoder stuck on its previous cursor. Now defaults to `["nft_transfer"]`, mirroring the FT decoder.

## 1.3.9

### Patch Changes

- 9a31a08: fix(l2-decoder): liveness ping bumps checkpoint updated_at every poll

  The healthcheck reported "unhealthy" when a decoder finished its work and quietly polled at-tip with no new events to process. The deploy script gated on health and bailed mid-recreate. Each runDecoder iteration now bumps `l2_decoder_checkpoints.updated_at` (without touching `last_cursor`) so `checkpoint_recent` becomes a true liveness signal: "process alive and looking" not "process found new rows."

## 1.3.8

### Patch Changes

- 89f053b: fix(bns): read nested `{name: {name, namespace}}` shape from on-chain emit

  The on-chain BNS-V2 contract emits the FQN as a nested tuple — `name = {name: <buff>, namespace: <buff>}` — not as flat sibling keys on the print payload. The decoder was reading flat keys and silently producing zero rows for every name event. It now prefers the nested shape and falls back to flat keys for legacy fixtures.

## 1.3.7

### Patch Changes

- 9346a8d: fix(decoders): use `raw_value` hex when decoding streams print payloads

  `decodeClarityPayload` in the BNS and sBTC decoders read `payload.value`, expecting a hex-shaped object. The streams API returns a structured `{Tuple: {data_map: ...}}` representation in `value` (which the decoder then passed through, undecoded), with the canonical hex form in a separate `raw_value` field. Net effect: BNS read events without producing any rows; sBTC would have hit the same path if the in-DB decoder were ever turned on. Decoders now prefer `raw_value` and fall back to the structured form for test fixtures.

## 1.3.6

### Patch Changes

- c71a9bb: fix(bns): reduce streams consume batch from 500 → 100

  The streams print-event query uses a jsonb predicate on `data->>'contract_identifier'` that lacks an index. At limit=500 over a multi-thousand-block backfill window the query takes >5s and Bun's fetch closes the socket before the response arrives. limit=100 returns in ~2s on prod and lets the decoder make steady forward progress while the underlying index work is queued.

## 1.3.5

### Patch Changes

- 3c53cb4: fix(streams): pipe contractId through events.consume / events.stream

  The streams events consumer had no way to push a server-side `contract_id` filter into the events fetch — only `types` was forwarded. On a backfill from a stale checkpoint that translates to "scan every print event in the cursor range across every contract," which on mainnet hit socket-close timeouts and stalled the BNS decoder. SDK `events.consume` / `events.stream` now accept `contractId` and forward it to the API; the BNS decoder uses it for the BNS-V2 mainnet contract.

- Updated dependencies:
  - @secondlayer/sdk@3.5.1

## 1.3.4

### Patch Changes

- f041151: fix(api): public status surfaces every enabled L2 decoder

  `/public/status.index.decoders[]` was hardcoded to `[ft, nft]` even when sbtc/pox4/bns were running. The list now derives from the same `*_DECODER_ENABLED` env flags the indexer reads, via a re-exported `getEnabledL2DecoderNames()` from `@secondlayer/indexer/l2/health`.

## 1.3.3

### Patch Changes

- a5da1d6: fix(streams): include `contract_event` in print-event mapping

  Print events were only mapped from the legacy `smart_contract_event` DB type. The upstream node renamed to `contract_event` around block 7828030 on mainnet, leaving every print-event consumer (BNS decoder, anything else that subscribes via `types: ["print"]`) seeing zero events for the entire post-rename range. The streams events reader now selects both DB labels and treats them identically — same payload shape, same `contract_identifier` resolution.

## 1.3.2

### Patch Changes

- b3004b8: fix(indexer): pox4 decoder Invalid Date crash + l2 health reports all enabled decoders

  - pox4 decoder was crashing every poll on `new Date(r.block_time)` because pg returns `blocks.timestamp` (bigint epoch-seconds) as a string of digits, which `new Date(string)` parses as a date _string_ → Invalid Date. Coerce via `Number()` and multiply to ms.
  - `getL2DecodersHealth()` defaulted to a hardcoded `[ft, nft]` list, hiding sbtc/pox4/bns from `/public/status` and the indexer's progress log even when their `*_DECODER_ENABLED` flags were set. Default now derives from those env flags.
  - Adds temporary `bns_decoder.batch` log to count received vs. matched events for diagnosing why bns writes zero rows on prod; removed in a follow-up patch.

## 1.3.1

### Patch Changes

- ba6a2f8: Fix l2-decoder unhealthy on container restart for PoX-4 and BNS decoders. Both now bump their checkpoint `updated_at` timestamp at decoder startup (before entering the consume loop) so the health endpoint reports `checkpoint_recent: true` immediately. Without this, fresh containers showed unhealthy status until the first tick wrote a checkpoint — which for BNS-V2 prints (sparse) could take many minutes.

  Also adds a first-enable seed for BNS: when no checkpoint exists, seed it to the latest canonical block before subscribing. Mirrors the existing PoX-4 first-enable seed and prevents BNS from sitting silent waiting for its first batch.

## 1.3.0

### Minor Changes

- 4cf176f: Add BNS Foundation Dataset — closes the 5-dataset shelf alongside STX Transfers, sBTC, PoX-4, and Network Health.

  **Decoder** (`l2.bns.v1`): subscribes to BNS-V2 contract print events, dispatches on three discriminator keys (`topic` for names, `status` for namespaces, `a` for marketplace), writes into 3 event tables and maintains 2 current-state projections (`bns_names`, `bns_namespaces`). Gated on `BNS_DECODER_ENABLED`.

  **API** (`/v1/datasets/bns/*`): six endpoints — `name-events`, `namespace-events`, `marketplace-events`, `names`, `namespaces`, `resolve?fqn=alice.btc`. Cursor pagination on event endpoints; current-state lookups against the projections.

  **Marketing**: `/datasets/bns` detail page, BNS flipped to "shipped" on the dataset index. Mainnet-only for v0; BNS-V1 historical data and subdomain resolution out of scope.

## 1.2.1

### Patch Changes

- f9eea00: Fix PoX-4 decoder showing as unhealthy during the long quiet windows between cycle-prep events. When the decoder catches up to tip with no pox-4 txs in range, it now advances the checkpoint to the latest canonical block (or bumps `updated_at` if already at tip) so the health endpoint's `checkpoint_recent` predicate stays true. Without this, the L2 decoder service container would flap to unhealthy status whenever no pox-4 calls had landed in the past 5 minutes — common given pox-4 activity is sparse outside cycle transitions.

## 1.2.0

### Minor Changes

- 1b7a5b3: Add PoX-4 transaction-result decoder (`l2.pox4.v1`). Reads canonical successful pox-4 contract calls from the local transactions table, decodes args + result via Clarity deserialization, writes to `pox4_calls`. Mainnet-only; forward-only ingestion (auto-seeds checkpoint to tip on first enable). Covers all 12 supported PoX-4 functions: stack-stx/extend/increase, delegate-stx, revoke-delegate-stx, delegate-stack-stx/extend/increase, stack-aggregation-commit/commit-indexed/increase, set-signer-key-authorization. Gated on `POX4_DECODER_ENABLED`.

## 1.1.0

### Minor Changes

- 4768a60: Add sBTC parquet publishers (events + token-events) under `stacks-datasets/mainnet/v0/sbtc/{events,token-events}/`. Single `SBTC_PUBLISHER_ENABLED` flag gates both. Manifest registry now exposes `sbtc-events` + `sbtc-token-events` slugs.

## 1.0.7

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.0.0

## 1.0.6

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@5.0.0
  - @secondlayer/stacks@2.0.1

## 1.0.5

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@2.0.0
  - @secondlayer/shared@4.1.1

## 1.0.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@4.0.0
  - @secondlayer/stacks@1.0.1

## 1.0.3

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`8f2d720`](https://github.com/ryanwaits/secondlayer/commit/8f2d72038c28aca7bd91efb4b0c93f72bac469d3), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8), [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64)]:
  - @secondlayer/shared@3.0.0
  - @secondlayer/stacks@1.0.0

## 1.0.3-alpha.0

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2)]:
  - @secondlayer/shared@3.0.0-alpha.0
  - @secondlayer/stacks@1.0.0-alpha.0

## 1.0.2

### Patch Changes

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0

## 1.0.1

### Patch Changes

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
  - @secondlayer/shared@1.1.0
  - @secondlayer/stacks@0.3.0

## 1.0.0

### Major Changes

- [#13](https://github.com/ryanwaits/secondlayer/pull/13) [`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Remove the streams product feature (real-time webhook deliveries) across the entire stack. Streams have been deprecated in favor of workflows + subgraphs.

  **Breaking changes:**

  - **SDK**: `client.streams.*` removed. `@secondlayer/sdk/streams` subpath export removed. `WorkflowSummary.triggerType` no longer accepts `"stream"`.
  - **CLI**: `sl streams *` commands removed (new, register, ls, get, set, logs, replay, rotate-secret, delete). `sl receiver`, `sl setup` commands removed. `sl status` / `sl doctor` no longer show stream/queue sections. `--wait` stop flags no longer drain a job queue.
  - **MCP**: `streams_*` tools removed. `workflows_scaffold` no longer accepts `type: "stream"` triggers. Stream filter MCP resource renamed to "event filter".
  - **API**: `/api/streams*` routes removed. `/api/logs/:id/stream` SSE endpoint removed. `/api/admin/stats` no longer returns `totalStreams`. `/api/accounts/usage` no longer returns `current.streams`. `/api/status` no longer returns queue/stream counts.
  - **Shared**: `StreamsTable`, `StreamMetricsTable`, `JobsTable`, `DeliveriesTable` dropped from `Database` interface. `@secondlayer/shared/queue` and `@secondlayer/shared/queue/recovery` subpaths removed. `@secondlayer/shared/db/queries/metrics` removed. `StreamNotFoundError` renamed to `NotFoundError`. `StreamsError` base class renamed to `SecondLayerError`. Dead subclasses `DeliveryError` and `FilterEvaluationError` removed. `StreamFilter` / `StreamFilterSchema` renamed to `EventFilter` / `EventFilterSchema`. `incrementDeliveries` removed (dead — no callers). `PlanLimits.streams` removed from `FREE_PLAN`.
  - **Worker**: stream processor, delivery dispatcher, signing, tracking, rate-limiter, and matcher all removed. Worker now runs only the scheduled storage-measurement job.
  - **Scaffold**: `generateStreamConfig` removed. Workflow trigger type no longer accepts `"stream"`.
  - **Workflows**: `StreamTrigger` type removed from `WorkflowTrigger` union.
  - **Workflow runner**: only `event` and `schedule` triggers are matched now.
  - **DB migration #32**: drops `streams`, `stream_metrics`, `jobs`, and `deliveries` tables. Renames PG NOTIFY channel from `streams:new_job` to `indexer:new_block`.

  **Bug fixes:**

  - CLI receiver was reading the wrong signature header (`x-streams-signature`) while the worker ships `X-Secondlayer-Signature`. The entire receiver is now removed.
  - Workflow scaffold paths (SDK + MCP + sessions) were emitting `type: "stream"` triggers that no longer typecheck against the workflows package.

### Patch Changes

- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f)]:
  - @secondlayer/shared@1.0.0

## 0.4.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.12.0

## 0.4.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0

## 0.4.1

### Patch Changes

- fix(subgraphs): expose resultHex in contract_call handler payload

  Adds `resultHex` (raw hex string) to the contract_call event payload so handlers can store the unmodified transaction result. Previously only the decoded Clarity object was available, causing `String(result)` to produce `[object Object]`.

  fix(indexer): normalize Hiro API function_args to hex strings

  Parser fallback now extracts `.hex` from `{hex,repr,name,type}` objects returned by the Hiro API, ensuring function_args are stored as hex strings consistently across all backfill sources.

## 0.4.0

### Minor Changes

- feat: add workflows support across packages

  - @secondlayer/sdk: add workflows client
  - @secondlayer/cli: add `sl workflows` commands
  - @secondlayer/mcp: add workflow tools for AI agents
  - @secondlayer/indexer: add tx repair script for missing function_args and raw_result

## 0.3.5

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0

## 0.3.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/stacks@0.2.2

## 0.3.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/stacks@0.2.0

## 0.2.0

### Minor Changes

- 04e4a49: Local-first block sourcing: tip-follower, integrity auto-backfill, and bulk-backfill try local DB before Hiro remote. Parser stores tx_index, API decode fallback now opt-in via ENABLE_TX_DECODE_FALLBACK.

### Patch Changes

- Updated dependencies [48e42ba]
- Updated dependencies [a070de2]
  - @secondlayer/shared@0.3.0
  - @secondlayer/stacks@0.1.0

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4
  - @secondlayer/shared@0.2.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3
  - @secondlayer/shared@0.2.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2
  - @secondlayer/shared@0.2.1

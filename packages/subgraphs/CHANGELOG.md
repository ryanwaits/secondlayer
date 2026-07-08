# @secondlayer/subgraphs

## 3.19.3

### Patch Changes

- 34990a4: fix(subgraphs): resolve + validate webhook hostnames before egress, closing the DNS-rebinding SSRF gap (any resolved private/link-local address, incl. 169.254.169.254, is refused)
- fix(subgraphs): serialize catch-up writes against reorg rewind so an in-flight catch-up walk can no longer clobber a reorg's cursor rewind (in-process per-subgraph lock + reorg-epoch guard)

## 3.19.2

### Patch Changes

- 90386b2: fix(subgraphs): widen the webhook outbox lock window past the maximum delivery
  timeout so a slow-but-alive receiver is not re-claimed mid-delivery

## 3.19.1

### Patch Changes

- 9f36120: fix(subgraphs): validate FK relation name as a SQL identifier, closing a
  deploy-time DDL-injection gap

## 3.19.0

### Minor Changes

- Email the deploying account when a subgraph reindex/backfill finishes (blocks/events/errors summary), gated on the account's `notify_reindex_complete` setting (defaults on). Fire-and-forget — a failed send only logs a warning, never affects the reindex result.

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@6.40.0

## 3.18.0

### Minor Changes

- b7345dc: Chain-subscription replay now covers on-Stacks sBTC peg triggers (deposit, withdrawal create/accept/reject) over a block range; `sl subscriptions replay` warns that the Bitcoin-confirmation settlement trigger (`sbtc_withdrawal_swept_confirmed`) is forward-only and not replayable. Adds chain-subscription creation to the CLI: `sl subscriptions create <name> --url <url> --trigger '<json>'` (repeatable) or `--triggers-file <path>`.

## 3.17.0

### Minor Changes

- 69c50cc: Add the `sbtc_withdrawal_swept_confirmed` webhook: fires once when a peg-out's committed BTC sweep crosses the confirmation threshold on Bitcoin. New `t.sbtcWithdrawalSweptConfirmed()` trigger + `SbtcWithdrawalSweptConfirmedEvent` payload, emitted by a scan-based evaluator path (`emitSbtcSettlementOutbox`) on its own `last_settlement_scan_at` cursor — forward-only (`confirmed_at > sub.created_at`), idempotent via the outbox dedup key (no double-fire on a reorg→un-confirm→re-confirm).

### Patch Changes

- c63476a: Fix the chain-trigger evaluator reading `sbtc_events` off the target (control) plane: that table is SOURCE-plane, so under the live source/target split the evaluator scanned an empty copy and the sBTC webhook topics never fired. `emitSbtcOutbox` now reads decoded rows via `getSourceDb()` while still writing the outbox on the target handle, with a regression test guarding the plane.
- 236b683: Fix `buildTraitContracts` reading the `contracts` registry off the target (control) plane: `contracts` is SOURCE-plane, so under the live split the evaluator and chain-replay resolved zero trait members and trait-scoped subscriptions never matched. Now reads via `getSourceDb()` — same plane-read class as the sbtc_events fix.
- Updated dependencies [6e570ea]
- Updated dependencies [69c50cc]
  - @secondlayer/shared@6.38.0

## 3.16.0

### Minor Changes

- Typed handler context fixes + faster event-only reindex:

  - `TypedSubgraphContext` now exposes `increment` (the reorg-safe accumulator), previously only on the untyped context.
  - uint/int columns accept `number` on write (the runtime coerces to bigint); reads stay strict `bigint`.
  - `upsert`'s `row` may omit the key columns (the runtime merges `{...key, ...row}`).
  - Event-only subgraph reindex synthesizes the transaction from joined event context instead of draining every transaction in each block range — a large full-history backfill speedup.

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@6.37.0

## 3.15.2

### Patch Changes

- Rename the decode plane off the `l2`/`layer2` naming (collides with the blockchain layer model — Bitcoin L1 / Stacks L2).

  - **shared**: DB schema type `l2_decoder_checkpoints` → `decoder_checkpoints` (and `L2DecoderCheckpointsTable` → `DecoderCheckpointsTable`); new migration `0103` renames the table and re-keys checkpoint names `l2.* → decode.*` in place (non-destructive — preserves cursors, no re-decode). Run migrations before booting the decoder. The internal Streams key/tenant defaults change to `sk-sl_streams_decode_internal` / `tenant_streams_decode_internal`.
  - **subgraphs**: streams-index block source falls back to the renamed internal Streams key default.
  - **sdk**: correct the webhook-verify JSDoc — issued signing secrets are bare 64-char hex (not `whsec_`-prefixed); `verifyWebhookSignature` handles both, but a generic Svix/Standard-Webhooks library will mis-base64-decode a bare-hex secret.

  Deploy note: the internal default key changed, so recreate api + decoder + subscription-processor together (a partial rollout 401s the decode reader until consistent).

- Updated dependencies
  - @secondlayer/shared@6.36.0

## 3.15.1

### Patch Changes

- 45e9c27: Avoid redundant array allocation in read-your-writes overlay: early-out when no ops are pending, mutate in place for update ops instead of re-mapping per op.
- 5021a58: Reject table/column/index identifiers that are not safe SQL identifiers at deploy-time validation.
- 1da5b8b: Elevate dropped reorg revert-emit log to error level and warn when active chain subscription count exceeds threshold.

## 3.15.0

### Minor Changes

- efa0e13: Add sBTC webhook trigger types and PoX reward-cycle aggregates.

  **shared**: 4 new `ChainTrigger` discriminated union members — `sbtc_deposit`, `sbtc_withdrawal_create`, `sbtc_withdrawal_accept`, `sbtc_withdrawal_reject` — each with typed filter schemas. New `SbtcDepositEvent` and `SbtcWithdrawalEvent` envelope interfaces exported from `chain-envelopes`.

  **subgraphs**: Trigger evaluator now processes sBTC events from `sbtc_events` table (separate query path from `decoded_events`). `emitSbtcOutbox` matches active chain subscriptions against canonical sBTC events per block and writes to `subscription_outbox`.

  **api**: `/v1/index/pox/cycles` and `/v1/index/pox/cycles/:reward_cycle` — paginated PoX-4 reward-cycle aggregates (total ustx locked, unique stackers/delegators, per-function breakdown, `is_current` flag). 30s cache for current cycle, 1h for completed.

### Patch Changes

- Updated dependencies [efa0e13]
  - @secondlayer/shared@6.34.0

## 3.14.4

### Patch Changes

- fd06663: Fail loud on boot when the webhook signing key is absent — the subscription-processor now refuses to start in prod (unless `ALLOW_UNSIGNED_WEBHOOKS=true`) rather than silently shipping unsigned deliveries
- Updated dependencies [fd06663]
  - @secondlayer/shared@6.33.2

## 3.14.3

### Patch Changes

- bfac8a5: ctx.increment debits no longer trip CHECK constraints on existing rows — Postgres validates the proposed INSERT tuple before ON CONFLICT arbitration, so every negative delta against an existing uint balance errored; increments now UPDATE-first with a guarded INSERT for missing rows (genuine negatives still fail loudly)

## 3.14.2

### Patch Changes

- e27d752: live walk promotes status toward active but never overwrites a "reindexing" park — per-block status stamping let catch-up flap a parked subgraph back into its own path, fighting the queued reindex op
- Updated dependencies [e27d752]
  - @secondlayer/shared@6.33.0

## 3.14.1

### Patch Changes

- a285bbb: fresh reindex resets the subgraph cursor with its schema drop — a stale cursor from a prior halted/cancelled run made the replay guard silently skip the entire history prefix (the sbtc-balances CHECK halt at block 1913668)

## 3.14.0

### Minor Changes

- ab8360d: backfill ops get their own crash checkpoint (cursor_block): written blocks advance it conditionally in the same transaction, replays skip, lost races roll back as skips, requeues inherit the committed prefix, and backfill walks never touch the live subgraph cursor. RELEASE NOTE: subgraphs + api must deploy in the same train (op-cursor enqueue semantics).
- 05b1b12: empirical print-event schema inference: GET /v1/index/contracts/:id/print-schema derives per-topic payload schemas (exact Clarity types from raw_value, presence rates) from indexed history; `sl subgraphs create --from-contract` scaffolds typed defs with prints maps + nullability comments (--table-per-topic for normalized layout); `sl subgraphs codegen --payloads` emits per-topic .d.ts; deploys warn on handler fields never observed for a source's topics; SDK index.printSchema + MCP index_print_schema; prints accepted by filter validation

### Patch Changes

- Updated dependencies [ab8360d]
- Updated dependencies [05b1b12]
  - @secondlayer/shared@6.32.0

## 3.13.0

### Minor Changes

- Accumulator correctness (fix-f040): handler reads are read-your-writes (pending same-block ops overlay DB state — patchOrInsert functional updaters no longer lose all but the last same-block delta per row); new ctx.increment(table, key, deltas) compiles to SQL-atomic ON CONFLICT delta upserts; a throwing handler contributes no partial writes; dispatch runs in chain order (tx_index, event_index); written blocks checkpoint atomically in the same transaction and replays are skipped; persistent block failures halt the walk (status=error, cursor stays before the failed block) instead of record-gap-and-skip; reorgs restore per-row journaled pre-images instead of deleting rows by \_block_height; uint columns get CHECK (>= 0); degraded block sources (consecutive empty batches) halt instead of minting false block_missing gaps.

## 3.12.0

### Minor Changes

- 9ee7879: tip-first deploys: backfillMode "concurrent" (CLI --tip-first) goes live at chain tip immediately and backfills history via a non-destructive background op; breaking redeploys refused pre-mutation; sync integrity reports history_filling while the op runs

### Patch Changes

- db40071: operation weight classes: claim query budgets heavy (broad) syncs and rank-orders by plan after per-account fairness; light contract-scoped syncs flow past queued whales; sparse helpers exported
- 8ac70d7: queue visibility: approximate queue position + event-based progress denominators + ETA on subgraph status (API sync block + CLI rendering); progress flush writes processed_events per operation
- Updated dependencies [db40071]
- Updated dependencies [8ac70d7]
- Updated dependencies [aef3e54]
- Updated dependencies [9ee7879]
  - @secondlayer/shared@6.31.0

## 3.11.0

### Minor Changes

- 5dc8fb3: sparse reindex: empty-match batches probe the next matchable height (contract-scoped) and leap there; boot-time sweep re-enqueues reindexes stranded by a processor restart; IndexHttpClient.firstEventHeight probe

### Patch Changes

- Updated dependencies [6fcd653]
- Updated dependencies [0449af7]
- Updated dependencies [5dc8fb3]
- Updated dependencies [3def7d4]
- Updated dependencies [38dad1c]
  - @secondlayer/shared@6.30.0

## 3.10.0

### Minor Changes

- e98f20d: Carry a structured migration plan on a refused BYO breaking-change deploy: `renderDeployPlan` now emits `dropStatement`, and the refuse path throws a typed `ByoBreakingChangeError` exposing `reasons`, `diff`, and the DROP + rebuild DDL.

### Patch Changes

- Updated dependencies [bbd40f7]
  - @secondlayer/shared@6.27.0

## 3.9.0

### Minor Changes

- f773a6e: Add `aggregate(spec)` to the typed subgraph table client. `AggregateSpec`/`AggregateResult` infer the result shape from the spec (count/countDistinct as numbers, sum/min/max as lossless strings). SUM/MIN/MAX are restricted to numeric columns at compile time; the `const` type parameter narrows results without `as const`.

### Patch Changes

- Updated dependencies [62e4d90]
  - @secondlayer/shared@6.26.0

## 3.8.0

### Minor Changes

- 321e69c: Add `deliverTestEvent(db, sub)` (exported from `@secondlayer/subgraphs/runtime/emitter`): builds a representative webhook for a subscription's configured format, POSTs it with the same SSRF guard + timeout + signing as a real delivery, and logs a `subscription_deliveries` row with a null `outbox_id` (so it shows under the subscription's deliveries without a queued event). Factors the shared `postToSubscription` transport out of the emitter hot path (behavior unchanged).
- abb689c: Export `TYPE_MAP` (from `@secondlayer/subgraphs/schema`) and `VALID_FILTER_TYPES` (from `@secondlayer/subgraphs/validate`) so consumers can single-source the column-type and filter-type vocab instead of hand-duplicating it.
- 4b88e5c: Add `generateIndexSchema(target, opts)` — emit a typed Prisma/Kysely/Drizzle/JSON-Schema for the public Index domain tables (blocks, decoded events, transactions, stacking, sBTC, BNS, …) from `SOURCE_READ_TYPES`, so a BYO database mirror is fully typed and can't drift from the API. Prisma uses `SOURCE_READ_PKS` for model identity; tables with no read-set primary key (e.g. chain_reorgs) are omitted from Prisma output but emitted by the other targets.
- 1b41df2: Add `generateKyselySchema` (the Kysely arm of codegen, alongside Prisma/Drizzle). Emits per-table interfaces + a `DB` registry keyed by schema-qualified table name, so a BYO database gets fully-typed Kysely query building over decoded subgraph rows. Lossless numeric/bigint as `string`, mirroring the deployed DDL.

### Patch Changes

- 3a7f8a2: Export typed chain-subscription webhook envelopes. `ChainApplyEnvelope`, `ChainReorgRollbackEnvelope`, `ChainReorgOrphanedEntry`, and the `ChainWebhookEnvelope` union are now single-sourced in `@secondlayer/shared` (the subgraphs producer uses them) and re-exported from `@secondlayer/sdk`, so webhook consumers can type the `chain.*.apply` / `chain.reorg.rollback` bodies they receive instead of reading code.
- cb2f803: Make the HTTP (Streams+Index) block source a soft dependency: when `SUBGRAPH_SOURCE=streams-index`, the subgraph processor and chain-trigger evaluator now wrap the HTTP source in a `FallbackBlockSource` that falls back to the Postgres tap per-call if api is unavailable, so the data plane keeps advancing instead of stalling during an api outage/rolling deploy. Mixing taps mid-stream is safe (same canonical chain, forward-only cursor); stateless so it's failover-safe across replicas and resumes the HTTP source transparently once healthy.
- 6e6026d: Fix: an additively-created subgraph table (new table added to an existing subgraph) now gets its UNIQUE constraints, composite indexes, column defaults, and foreign keys — previously the deployer's additive path hand-rolled a bare CREATE TABLE that omitted them, so a handler `upsert` (`ON CONFLICT`) on such a table failed at runtime with "no unique constraint matching the ON CONFLICT specification". The full generator and the additive path now share one `emitTableDDL`/`emitForeignKeyDDL` emitter so they can't drift.
- Updated dependencies [3a7f8a2]
- Updated dependencies [14657ae]
- Updated dependencies [3a57c08]
- Updated dependencies [af82681]
  - @secondlayer/shared@6.25.0

## 3.7.4

### Patch Changes

- 922f14c: Stop booting the subscription delivery plane inside the subgraph processor now that the dedicated subscription-processor service runs it. `startSubgraphProcessor` no longer calls `startSubscriptionPlane()` — it handles subgraph operations, catch-up, and the subgraph-reorg rewind only, while the evaluator, outbox emitter, and chain-reorg rewind live solely in the subscription-processor. Completes the two-deploy extraction (the prior release ran both alongside, made safe by leader election); webhook delivery is now isolated from subgraph indexing.

## 3.7.3

### Patch Changes

- 5b7fccf: Leader-elect the subgraph catch-up driver so the processor can scale out. Catch-up ran on every NOTIFY/poll guarded only by an in-process Set, so 2+ processors double-processed every block (idempotent upserts kept it correct, but with no throughput gain). The NOTIFY/poll/startup paths now share one `runCatchUp()` helper gated on `isCatchUpLeader()` (`SUBGRAPH_CATCHUP_LOCK_KEY`, pinned to the target DB that homes the `subgraphs` table); a newly elected leader runs an immediate catch-up. The in-process Set stays as the within-process guard.
- fd8503b: Co-gate the chain-subscription reorg handler under the evaluator leader lock. `handleChainReorg` rewinds `trigger_evaluator_state.last_processed_block` — the same row the evaluator advances — so on a multi-replica plane it must run only on the elected evaluator leader, else a non-leader reorg rewind races the leader's forward cursor. The reorg poll now wraps the chain-reorg callback in `gateChainReorgOnLeader` (fires only when `isEvaluatorLeader()`); the subgraph-reorg handler stays ungated (idempotent row-deletes).
- 958c883: Support replay/catch-up for chain subscriptions. Replay previously threw for `kind=chain` because it scanned a subgraph's processed table, which chain subs don't have — so a chain receiver that was down past the outbox retry window permanently lost events. Replay now re-runs the pure trigger matcher over the requested canonical block range (reloading blocks off the public Index/Streams clock) and emits fresh apply rows with `is_replay=true` and replay-namespaced dedup keys, so missed deliveries are re-sent without colliding with the original live rows and re-running the same range stays idempotent. Replay never advances `trigger_evaluator_state` — it's historical and must not move the live forward cursor. `emitChainOutbox` now returns the net-inserted count so callers tally genuinely new deliveries.
- b044f39: Leader-elect the chain-trigger evaluator so the real-time subscription plane can scale out. Previously the evaluator ran unconditionally on every replica against one global cursor (N replicas → N× redundant Index fetch+match each tick; correct via `dedup_key`, but a de-facto one-replica cap). The whole loop now runs only on the process holding `SUBSCRIPTION_EVALUATOR_LOCK_KEY`, with the lock pinned to the target DB that homes `trigger_evaluator_state`. Exposes `isEvaluatorLeader()` so the chain-reorg cursor rewind can gate on the same election.
- 250e910: Emit subgraph subscription webhooks for updates and deletes, not just inserts. `emitSubscriptionOutbox` previously skipped any flush write whose op wasn't `insert` and hardcoded the event type to `.created`, so a receiver tracking a mutable row saw it appear then went silent on every transition. The op now maps to a lifecycle verb — `insert → .created`, `update → .updated`, `delete → .deleted` — while the dedup-key format is unchanged so existing `.created` rows stay idempotent across replays.
- f1706c0: Factor the real-time subscription delivery plane (chain-trigger evaluator, outbox emitter, chain-reorg rewind) into `startSubscriptionPlane()` and add a dedicated `subscription-service.ts` entrypoint that boots only that plane. This isolates webhook delivery from subgraph indexing so a crash-looping or CPU-hot subgraph can't stall deliveries, and lets the plane scale out on its own. The subgraph processor still boots the same plane for now (a later two-deploy cutover moves it to the dedicated service). The Streams reorg poll is simplified to a single per-fork callback so each plane runs its own poll — subgraph-reorg rewind in the subgraph processor, chain-subscription rewind in the subscription plane.
- 61ef1d4: Sign every subscription webhook with a universal ed25519 signature, regardless of body format. Previously only the `standard-webhooks` format carried an HMAC; `raw`, `cloudevents`, `trigger`, `cloudflare`, and `inngest` deliveries carried no Secondlayer proof, so a receiver had no way to verify a payload came from us. Each delivery now also gets `webhook-id` + `X-Secondlayer-Signature` (ed25519 over `${webhook-id}.${body}`) + `X-Secondlayer-Signature-KeyId`, signed with a single platform key (`SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY`, falling back to the existing `STREAMS_SIGNING_PRIVATE_KEY`). Body shapes stay format-specific. Receivers verify with the new `verifySecondlayerSignature(rawBody, headers, publicKeyPem)` SDK helper against the published public key — no per-subscription secret. Signing is a no-op when no key is configured, so it is safe to ship before the key is provisioned. Also publishes `@secondlayer/shared/crypto/ed25519` as an importable subpath.
- Updated dependencies [434c947]
- Updated dependencies [eccd246]
- Updated dependencies [61ef1d4]
  - @secondlayer/shared@6.23.0

## 3.7.2

### Patch Changes

- b1366b3: Make the LISTEN/NOTIFY listener split-aware. Export `sourceListenerUrl()` / `targetListenerUrl()` from `@secondlayer/shared/queue/listener` and bind the subscriptions emitter (`subscriptions:new_outbox` / `subscriptions:changed`) to the TARGET DB where those channels fire. Previously the emitter passed no connection string and fell back to `DATABASE_URL`, crashing the subgraph-processor under the active source/target split when `DATABASE_URL` was unset. The subgraph-processor's block/reorg/operation listeners now share the same shared helpers (dedup).
- Updated dependencies [b1366b3]
  - @secondlayer/shared@6.21.0

## 3.7.1

### Patch Changes

- 8c7c24c: Surface the chain/control DB split state so its dormancy in prod is visible, not silent: add `getDbSplitStatus()` (source/target host+db, no credentials) exposed on the API `/status` and `/public/status` responses; extend `assertDbSplit()` to warn on a dormant single-failure-domain in prod and error when a split var is unset with no `DATABASE_URL` fallback (the silent wrong-DB case); wire `assertDbSplit()` into the worker and subgraph-processor entrypoints
- b10a67b: Treat an empty-string SOURCE\_/TARGET_DATABASE_URL (passed through docker-compose as "") as unset in the LISTEN/NOTIFY and subgraph-cache paths — `||` instead of `??` — so single-DB mode falls back to DATABASE_URL instead of crashing the subgraph processor
- Updated dependencies [8c7c24c]
- Updated dependencies [a199aeb]
- Updated dependencies [b10a67b]
  - @secondlayer/shared@6.20.0

## 3.7.0

### Minor Changes

- 56bc457: feat: direct chain-level subscriptions (webhooks on chain events, no subgraph)

  Subscriptions are now polymorphic: a `subgraph` subscription fires on a deployed subgraph's table rows (unchanged), or a new `chain` subscription fires on raw chain events directly — a webhook on a contract / event-type / function-call, or any SIP-010/SIP-009/custom trait — with no subgraph to deploy.

  - SDK: `subscriptions.create({ triggers: [...] })` plus `on.*` trigger builders (`on.contractCall`, `on.ftTransfer`, …). New `ChainTrigger` / `SubscriptionKind` types; `SubscriptionDetail` gains `kind` + `triggers`.
  - Built on the public Index/Streams clock (reuses the subgraph re-point's `PublicApiBlockSource` + matcher); forward-looking (starts at tip, never backfills).
  - Reorg-safe apply/rollback delivery envelope (`chain.{type}.apply` / `chain.reorg.rollback`); per-subscription HMAC signing and all delivery formats reused unchanged.
  - Trait-scoped triggers require the contract registry (`CONTRACT_REGISTRY_ENABLED=true`).

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.16.0

## 3.6.1

### Patch Changes

- 0fbb4fa: Normalize the `contract_call` handler payload's spread event `value` to the decoded canonical (from `raw_value`) — completing source-independent parity for contract_call sources whose matched tx carries print/nft events (the node's serde-tagged `value` is not reproducible from the Index API). Also default stx_transfer `memo` to `""` to match the DB tap. Verified byte-identical across all source types via the golden-diff over real prod blocks.

## 3.6.0

### Minor Changes

- 943ae7b: NFT event handlers now receive `tokenId` decoded from the canonical hex (clean `cvToValue`, e.g. `223n`) instead of the stacks-node's verbose serde-tagged form (`{ UInt: 223 }`). This makes the value source-independent (identical whether the runtime reads the indexer DB or the public Index API) and far friendlier for handler authors. Print event values already decoded this way. Behavior change for NFT `tokenId` shape — reindex NFT subgraphs to pick up the new representation.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.15.0

## 3.5.0

### Minor Changes

- 501e095: Add realtime subgraph row streaming over Server-Sent Events. A new endpoint `GET /api/subgraphs/<name>/<table>/stream` pushes rows as they're indexed (go-forward by default, `?since=<block>` to replay then tail), accepting the same column filters as the list endpoint. The SDK's typed client gains `subgraph.<table>.subscribe(onRow, { where, since })`, which opens the stream and returns an unsubscribe function — a browser-friendly way to react to indexed data live without running a webhook receiver.

## 3.4.0

### Minor Changes

- 948c0d5: Add `in`/`notIn`/`like` filter operators and deterministic multi-column ordering to the subgraph query client. `findMany`/`count` now accept `{ col: { in: [...] }, name: { like: "a%" } }` and `orderBy: [["blockHeight","desc"],["id","asc"]]`. All values are parameterized server-side (`IN ($1,$2,…)`); `in`/`notIn` are comma-encoded over REST so values cannot contain commas.

## 3.3.0

### Minor Changes

- 0c3ba82: Add bring-your-own-database support to subgraphs. Deploy with `sl subgraphs deploy <file> --database-url <postgres-url>` to write a subgraph's schema, handler rows, and serving reads to your own Postgres while the managed pipeline still ingests, decodes, matches, and runs your handler. The connection string is stored encrypted at rest and never returned. Handler writes must be idempotent (insert/upsert); reindex is unavailable on BYO subgraphs (re-deploy to rebuild), and deleting a BYO subgraph never drops the schema in your database.
- 0c3ba82: Add ORM codegen and contract trait discovery.

  `sl subgraphs generate <file> --target prisma|drizzle` emits a typed ORM schema for a subgraph's tables — point it at your BYO database for a fully-typed Prisma/Drizzle client with relations (`@relation` / `relations()`), inferred row types, and FK constraints that mirror the deployed DDL. Kysely is supported via `kysely-codegen` against your database.

  Contract trait discovery adds a contract registry that statically classifies deployed contracts against SIP-009/010/013 (by ABI shape inference and declared `impl-trait`s) and exposes `GET /v1/contracts?trait=sip-010&conformance=declared|inferred|any` to find every conforming contract.

- 0d94c36: Add trait-scoped subgraph sources. A source can target a SIP standard instead of a fixed contract — `{ type: "ft_transfer", trait: "sip-010" }` indexes events across every contract the registry classifies as that standard, including ones deployed later. Token filters match by the asset-identifier's contract; contract_call/print match by contract id; trait composes with other filters. Resolution is as-of-block, so a reindex backfills a contract's full history even if it was classified after deploy. Requires the contract registry to be populated.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.9.0
  - @secondlayer/stacks@2.3.0

## 3.2.1

### Patch Changes

- 229c297: Add license, repository, and homepage metadata plus a bundled LICENSE file; drop src from clarity-docs npm files.
- Updated dependencies:
  - @secondlayer/shared@6.4.5
  - @secondlayer/stacks@2.2.1

## 3.2.0

### Minor Changes

- f0b7859: Type `contract_call` arguments from the contract ABI. A `contract_call` source can carry a `const` `abi`; the handler then receives `event.input` — the named, decoded function arguments typed from the ABI (camelCase keys, `uint128` → `bigint`, `buff` → `Uint8Array`, tuples/optionals/responses shaped per the ABI). The positional `event.args` is kept for back-compat. Sources without an `abi` are unchanged.

## 3.1.0

### Minor Changes

- b9cc82e: Type print `event.data` per topic. A `print_event` source can declare a `prints` map (`{ [topic]: { [field]: ColumnType } }`); the handler's `event` then becomes a discriminated union keyed by `topic` with `event.data` typed per topic (same column-type vocab as `schema` — `"uint"` → `bigint`, `"principal"` → `string`, nested → `"jsonb"`). Sources without `prints` keep the untyped `Record<string, unknown>` data. Type-level only — no runtime change.

## 3.0.0

### Major Changes

- fc94993: Typed subgraph handlers. `event` is now inferred from each source's `type` (e.g. a `print_event` source gives `event.topic: string`, an `ft_transfer` source gives `event.amount: bigint`), and `ctx` is typed against the schema — table names and row columns in `ctx.insert`/`update`/`upsert`/etc. are checked. Removes the need for `event as {...}` casts.

  BREAKING: handler `event` and `ctx` are now strictly typed, so existing handlers may surface new type errors (usually real shape mismatches). No runtime behavior changes.

## 2.0.9

### Patch Changes

- aad48bc: Compute schema hashes with node crypto instead of Bun.hash so the node-runtime CLI can run `sl subgraphs inspect`

## 2.0.8

### Patch Changes

- d304339: `SubgraphFilterSchema` is now `.strict()`, so unknown fields inside a `sources: {}` entry (most commonly a mis-placed `startBlock`) error at validate time instead of being silently dropped. `startBlock` is only valid at the top level of `defineSubgraph()`.

## 2.0.7

### Patch Changes

- a852994: Match `print_event` sources whose payload stores the contract under `contract_id` (in addition to `contract_identifier`). Mirrors the streams query's dual-shape lookup. Without this, every `print_event` subgraph with a `contractId` filter silently indexed 0 rows for the newer `contract_event` payload shape.

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

### Patch Changes

- 69ef11a: subgraph deploy: detect handler-only changes, add ContractCallEvent type, remove version override flag
- Updated dependencies:
  - @secondlayer/shared@6.4.2

## 2.0.2

### Patch Changes

- fc8f486: Housekeeping polish:

  - Dropped fictitious typed-key prefixes (`sk-sl_streams_…`, `sk-sl_index_…`) from marketing copy + sandbox placeholder. Real keys are generic `sk-sl_…`; scoped prefixes were doc fiction.
  - Index rate-limit 429 for free tier now returns `{required_tier, upgrade_url}` so blocked users know how to unblock.
  - `sl subgraphs status <name> --watch` polls every 2s, clearing screen between snapshots, exits cleanly when synced.
  - `standard-webhooks.ts` docstring clarified that only `.created` is emitted in v1; `.updated`/`.deleted` are deferred.
  - T8.6 `sl subgraphs logs` deferred — needs server-side log storage.
  - T8.3 broken tenant URL strip is `[infra]`, tracked in ops backlog.

- Updated dependencies:
  - @secondlayer/shared@6.4.1

## 2.0.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.3.5

## 2.0.0

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.0.0

## 1.3.4

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@5.0.1

## 1.3.3

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@5.0.0
  - @secondlayer/stacks@2.0.1

## 1.3.2

### Patch Changes

- 1a3a80d: Harden tenant runtime environment injection, subgraph operation cleanup, subscription scoping, and destructive CLI error handling.
- Updated dependencies [1a3a80d]
  - @secondlayer/shared@4.3.3

## 1.3.1

### Patch Changes

- [`230e4cf`](https://github.com/ryanwaits/secondlayer/commit/230e4cf8ad8c3a7da9a39226a7cab8ac6c621b5d) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Reset reindex health counters for fresh reindexes and flush event/error totals during long reindex and backfill operations.

## 1.3.0

### Minor Changes

- Run durable subgraph reindex and backfill operations from the tenant processor, including claim, cancel, heartbeat, stale-lock recovery, and legacy resume handling.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@4.3.0

## 1.2.2

### Patch Changes

- Make subgraph reindex batch sizing tenant-plan aware so Hobby runtimes use low-memory bounds while paid and default runtimes retain standard throughput.

## 1.2.1

### Patch Changes

- [`4462afd`](https://github.com/ryanwaits/secondlayer/commit/4462afded306504a9cac1bf4559333bf3d79e6d8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Stabilize subgraph deploys by importing generated handlers through file URLs,
  evaluating bundled subgraphs from temporary modules instead of data URIs, and
  adding a CLI deploy dry-run preview. ABI scaffolding now reports the actual
  Secondlayer node source and fails quickly when contract fetches are unavailable.

## 1.2.0

### Minor Changes

- Move typed trigger helpers from `@secondlayer/stacks/triggers` to `@secondlayer/subgraphs/triggers`.

  `@secondlayer/stacks` no longer exports `./triggers` and no longer depends on `@secondlayer/subgraphs`.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@2.0.0
  - @secondlayer/shared@4.1.1

## 1.1.0

### Minor Changes

- Runtime hardening: SSRF v6 blocking, deterministic replay IDs, claim lock on dispatch, atomic circuit-breaker increments, decrypt errors surfaced to callers, matcher boot retry, bigint matcher support, standard-webhooks timestamp on dispatch.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@4.0.0
  - @secondlayer/stacks@1.0.1

## 1.0.0

### Major Changes

- [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Declaring stable (1.0) ahead of subscription emission work (Sprint 3). No API changes in this release; major bundles the break point for subscription wiring that lands next sprint.

### Minor Changes

- GA — stable release.

  Subgraphs + subscriptions + stacks SDK + MCP + CLI scaffolder all land on `latest` dist-tag:

  - `@secondlayer/sdk@3.0.0` — `sl.subgraphs.*` + `sl.subscriptions.*` (CRUD, rotateSecret, replay, dead-letter requeue, recent deliveries)
  - `@secondlayer/shared@3.0.0` — tables + queries for subgraphs, subscriptions, outbox, deliveries; Standard Webhooks helper; OSS secrets bootstrap
  - `@secondlayer/subgraphs@1.0.0` — typed subgraph runtime + post-flush emitter with LISTEN, FOR UPDATE SKIP LOCKED, per-sub concurrency, circuit breaker, backoff, 6-format dispatcher, replay, retention, SSRF egress guard
  - `@secondlayer/stacks@1.0.0` — viem-style Stacks client; workflow-runner-era broadcast/tx/ui surfaces removed
  - `@secondlayer/mcp@2.0.0` — subgraph + subscription tools (including replay + recent_deliveries)
  - `@secondlayer/cli@3.2.0` — `sl create subscription --runtime <inngest|trigger|cloudflare|node>` scaffolder

  Perf baseline (200 blocks × 20 subs, local): `emitMs` p95 ≈ 52ms, `deliveryMs` p95 ≈ 6ms, 100% delivery rate. Failure modes tested: receiver-kill mid-batch, processor tx rollback, clock-skew replay-attack reject. SSRF guard on by default (opt-out via `SECONDLAYER_ALLOW_PRIVATE_EGRESS=true` for self-host + local dev).

  Previous workflow-era `@secondlayer/sdk@2.0.0` and earlier remain on npm but are not the default `latest` anymore.

- [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Multi-format dispatch + `sl create subscription` scaffolder.

  - `@secondlayer/subgraphs`: 5 new format builders — Inngest events API, Trigger.dev v3 task trigger, Cloudflare Workflows, CloudEvents 1.0 structured JSON, and raw. The emitter dispatches on `subscription.format`; unknown values fall back to `standard-webhooks` with a warning log.
  - `@secondlayer/cli`: `sl create subscription <name> --runtime <inngest|trigger|cloudflare|node>` scaffolds a runtime-specific receiver project (package.json + src + README + tsconfig), then provisions the subscription via the SDK and writes the one-time signing secret into `.env`. Templates live at `packages/cli/templates/subscriptions/<runtime>/` and ship in the npm tarball.

- [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Replay + DLQ + MCP subscription tools.

  - `@secondlayer/subgraphs`: new `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` re-enqueues historical rows as outbox entries marked `is_replay=TRUE`. Emitter claims batches 90/10 live vs replay so replays never starve live deliveries.
  - `@secondlayer/sdk`: `sl.subscriptions.replay(id, range)`, `recentDeliveries(id)`, `dead(id)`, `requeueDead(id, outboxId)`.
  - `@secondlayer/mcp`: 7 new subscription tools — `subscriptions_list|get|create|update|delete|replay|recent_deliveries`. Restart MCP clients after upgrade so the tool cache refreshes.
  - Dashboard subscription detail: replay dialog (block range prompt) + DLQ tab listing dead rows with one-click requeue.
  - API: `POST /api/subscriptions/:id/replay`, `GET .../dead`, `POST .../dead/:outboxId/requeue`.

- [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Subscription emitter lands — the end-to-end delivery loop.

  - `SubgraphContext.flush()` now returns a `FlushManifest` describing every write. Existing callers ignoring the return value keep working.
  - `emitSubscriptionOutbox()` runs inside the block-processor transaction: matches each write against active subscriptions, inserts outbox rows (bulk `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, dedup_key)` for idempotent replays). Bypassed when `SECONDLAYER_EMIT_OUTBOX=false`.
  - `startEmitter()` boots alongside `startSubgraphProcessor`. `LISTEN subscriptions:new_outbox` + `LISTEN subscriptions:changed`, `FOR UPDATE SKIP LOCKED LIMIT 50` batch claim, per-sub in-memory concurrency semaphore (default 4), HTTP dispatch via Standard Webhooks format with AbortSignal timeout, `subscription_deliveries` attempt log truncated to 8KB. Circuit breaker trips at 20 consecutive failures → sub `paused`. Backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h. Retention sweep hourly.
  - Dashboard subscription detail page polls the last 100 deliveries every 5s.
  - Emitter requires session-mode PG connection — pgbouncer transaction mode breaks the persistent LISTEN. Document in migration guide.

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`8f2d720`](https://github.com/ryanwaits/secondlayer/commit/8f2d72038c28aca7bd91efb4b0c93f72bac469d3), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8), [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64)]:
  - @secondlayer/shared@3.0.0
  - @secondlayer/stacks@1.0.0

## 1.0.0-beta.3

### Minor Changes

- Replay + DLQ + MCP subscription tools.

  - `@secondlayer/subgraphs`: new `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` re-enqueues historical rows as outbox entries marked `is_replay=TRUE`. Emitter claims batches 90/10 live vs replay so replays never starve live deliveries.
  - `@secondlayer/sdk`: `sl.subscriptions.replay(id, range)`, `recentDeliveries(id)`, `dead(id)`, `requeueDead(id, outboxId)`.
  - `@secondlayer/mcp`: 7 new subscription tools — `subscriptions_list|get|create|update|delete|replay|recent_deliveries`. Restart MCP clients after upgrade so the tool cache refreshes.
  - Dashboard subscription detail: replay dialog (block range prompt) + DLQ tab listing dead rows with one-click requeue.
  - API: `POST /api/subscriptions/:id/replay`, `GET .../dead`, `POST .../dead/:outboxId/requeue`.

## 1.0.0-beta.2

### Minor Changes

- Multi-format dispatch + `sl create subscription` scaffolder.

  - `@secondlayer/subgraphs`: 5 new format builders — Inngest events API, Trigger.dev v3 task trigger, Cloudflare Workflows, CloudEvents 1.0 structured JSON, and raw. The emitter dispatches on `subscription.format`; unknown values fall back to `standard-webhooks` with a warning log.
  - `@secondlayer/cli`: `sl create subscription <name> --runtime <inngest|trigger|cloudflare|node>` scaffolds a runtime-specific receiver project (package.json + src + README + tsconfig), then provisions the subscription via the SDK and writes the one-time signing secret into `.env`. Templates live at `packages/cli/templates/subscriptions/<runtime>/` and ship in the npm tarball.

## 1.0.0-beta.1

### Minor Changes

- Subscription emitter lands — the end-to-end delivery loop.

  - `SubgraphContext.flush()` now returns a `FlushManifest` describing every write. Existing callers ignoring the return value keep working.
  - `emitSubscriptionOutbox()` runs inside the block-processor transaction: matches each write against active subscriptions, inserts outbox rows (bulk `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, dedup_key)` for idempotent replays). Bypassed when `SECONDLAYER_EMIT_OUTBOX=false`.
  - `startEmitter()` boots alongside `startSubgraphProcessor`. `LISTEN subscriptions:new_outbox` + `LISTEN subscriptions:changed`, `FOR UPDATE SKIP LOCKED LIMIT 50` batch claim, per-sub in-memory concurrency semaphore (default 4), HTTP dispatch via Standard Webhooks format with AbortSignal timeout, `subscription_deliveries` attempt log truncated to 8KB. Circuit breaker trips at 20 consecutive failures → sub `paused`. Backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h. Retention sweep hourly.
  - Dashboard subscription detail page polls the last 100 deliveries every 5s.
  - Emitter requires session-mode PG connection — pgbouncer transaction mode breaks the persistent LISTEN. Document in migration guide.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@3.0.0-beta.2

## 1.0.0-alpha.0

### Major Changes

- Declaring stable (1.0) ahead of subscription emission work (Sprint 3). No API changes in this release; major bundles the break point for subscription wiring that lands next sprint.

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2)]:
  - @secondlayer/shared@3.0.0-alpha.0
  - @secondlayer/stacks@1.0.0-alpha.0

## 0.11.8

### Patch Changes

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0

## 0.11.7

### Patch Changes

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
  - @secondlayer/shared@1.1.0
  - @secondlayer/stacks@0.3.0

## 0.11.6

### Patch Changes

- [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Server-side subgraph bundler + source capture, mirroring the workflows authoring loop.

  - **API**: new `POST /api/subgraphs/bundle` runs `bundleSubgraphCode` from `@secondlayer/bundler` and returns `{ name, version, sources, schema, handlerCode, sourceCode, bundleSize }`. `BundleSizeError → 413`, other failures → 400 with `code: "BUNDLE_FAILED"`. New `GET /api/subgraphs/:name/source` returns the original TypeScript source for deployed subgraphs, or a `readOnly` payload for rows predating the migration. `POST /api/subgraphs` now threads `sourceCode` through `deploySchema` so the original source is persisted on deploy.
  - **SDK**: new `subgraphs.bundle({ code })` and `subgraphs.getSource(name)` methods + `BundleSubgraphResponse` / `SubgraphSource` types.
  - **shared**: migration `0031_subgraph_source_code` adds `source_code TEXT NULL` to the `subgraphs` table; `registerSubgraph` upsert + `DeploySubgraphRequest` schema both accept an optional `sourceCode` field (max 1MB).
  - **subgraphs**: `deploySchema()` accepts `sourceCode` in its options and forwards it to `registerSubgraph`.

  Unlocks the next wave of the chat authoring loop (read/edit/deploy/tail subgraphs in a session).

- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f)]:
  - @secondlayer/shared@1.0.0

## 0.11.5

### Patch Changes

- record errors to total_errors/last_error during reindex block processing

## 0.11.4

### Patch Changes

- fix: use delete instead of undefined assignment for internal metadata keys to prevent them appearing as SQL columns

## 0.11.3

### Patch Changes

- fix \_tx_id attribution: capture at insert time instead of flush time to prevent cross-tx misattribution within a block

## 0.11.2

### Patch Changes

- fix schema diff false positives from JSONB key reordering; hot-reload handler code after redeploy; handle bigint in jsonb serialization

- Updated dependencies []:
  - @secondlayer/shared@0.12.2

## 0.11.1

### Patch Changes

- fix(subgraphs): complete accountId migration across deployer, marketplace, ownership

  Removes remaining apiKeyId fallbacks introduced in the Sprint 1 account-scoping change:

  - deployer.ts: getSubgraph lookup no longer falls back to apiKeyId
  - marketplace.ts: fork collision check and schema prefix use accountId
  - ownership.ts: assertSubgraphOwnership checks account_id instead of api_key_id
  - deleteSubgraph: uses accountId parameter consistently

- Updated dependencies []:
  - @secondlayer/shared@0.12.1

## 0.11.0

### Minor Changes

- feat(subgraphs): smart deploy — auto-versioning, auto-reindex, schema diff

  - System now owns versioning: patch auto-increments on every deploy (1.0.0 → 1.0.1); use --version flag for intentional bumps
  - Breaking schema changes auto-trigger reindex — no --reindex flag needed
  - Deploy output shows schema diff (added tables/columns, breaking changes, new version)
  - version field removed from schema hash so version bumps don't look like schema changes
  - --force flag skips reindex confirmation prompt
  - Handler code persisted in DB so container restarts don't break in-flight reindexes (migration 0029)

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.12.0

## 0.10.0

### Minor Changes

- feat(subgraphs): account-wide subgraph scoping

  Subgraphs are now scoped at the account level rather than per API key. Any API key on the same account can deploy and update the same named subgraph without creating duplicates. Includes migration 0028 which adds `account_id` to the subgraphs table and renames existing PG schemas to use account prefix instead of key prefix.

  **Breaking for self-hosted:** Run migration 0028 before deploying. Stop the subgraph processor before running the migration (it renames live PG schemas).

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0

## 0.9.5

### Patch Changes

- fix(subgraphs): parse JSONB string for function_args before array check

  postgres.js returns JSONB columns as JSON-encoded strings rather than parsed JavaScript objects. The function_args decoder was calling Array.isArray() on a string and always returning [], causing args_json to be empty for every indexed contract call. Now correctly parses the string before the array check.

## 0.9.4

### Patch Changes

- fix(subgraphs): expose resultHex in contract_call handler payload

  Adds `resultHex` (raw hex string) to the contract_call event payload so handlers can store the unmodified transaction result. Previously only the decoded Clarity object was available, causing `String(result)` to produce `[object Object]`.

  fix(indexer): normalize Hiro API function_args to hex strings

  Parser fallback now extracts `.hex` from `{hex,repr,name,type}` objects returned by the Hiro API, ensuring function_args are stored as hex strings consistently across all backfill sources.

## 0.9.3

### Patch Changes

- Allow ComputedValue callbacks to return unknown so existing record field access doesn't need casts

## 0.9.2

### Patch Changes

- Narrow ComputedValue type so patchOrInsert callback params are inferred without explicit annotation

## 0.9.0

### Minor Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

### Patch Changes

- Updated dependencies [885662d]
  - @secondlayer/shared@0.10.1

## 0.8.1

### Patch Changes

- Fix phantom gaps caused by adaptive batch sizing: batchEnd now uses the actual prefetched range instead of the potentially resized batchSize.

## 0.8.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0

## 0.7.3

### Patch Changes

- Cache compiled regex patterns in source matcher, use pg_stat estimates instead of COUNT(\*) for row count warnings.

## 0.7.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0

## 0.7.1

### Patch Changes

- e274333: fix(subgraphs): use highest_seen_block ceiling and add startBlock support
- Updated dependencies [e274333]
  - @secondlayer/shared@0.8.1

## 0.7.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0

## 0.6.0

### Minor Changes

- Batch block fetching with adaptive sizing and prefetch pipeline for 15-18x faster subgraph catch-up. Batch INSERT statements on flush. Non-destructive backfill support. Increase default DB connection pool to 20.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.1

## 0.5.7

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0

## 0.5.6

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/stacks@0.2.2

## 0.5.5

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

- Updated dependencies []:
  - @secondlayer/shared@0.5.1

## 0.5.4

### Patch Changes

- Export template registry from subgraphs package.

## 0.5.3

### Patch Changes

- fix(subgraphs): fix Zod v4 type cast in validate.ts
  chore(sdk): remove dangling ./contracts export

## 0.5.2

### Patch Changes

- Coerce numeric columns to BigInt in findOne/findMany results so arithmetic works correctly in handlers.

## 0.5.1

### Patch Changes

- CLI: bundle updated SDK with query response unwrap fix. Subgraphs: use NUMERIC for uint/int columns to handle Clarity values > bigint max.

## 0.5.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0

## 0.3.0

### Minor Changes

- Add trigram search support for full-text indexed queries. Add contract-deployments reference subgraph. Fix contractId resolution in deployment handler. Replace string-matching error detection with typed guard functions.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/stacks@0.2.0

## 0.2.4

### Patch Changes

- Updated dependencies [48e42ba]
- Updated dependencies [a070de2]
  - @secondlayer/shared@0.3.0
  - @secondlayer/stacks@0.1.0

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4
  - @secondlayer/shared@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3
  - @secondlayer/shared@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2
  - @secondlayer/shared@0.2.1

## 0.2.0

### Minor Changes

- Add @secondlayer/subgraphs - Subgraph definition, validation, schema generation, and deployment for materialized blockchain subgraphs

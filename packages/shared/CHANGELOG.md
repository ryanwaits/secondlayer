# @secondlayer/shared

## 7.0.3

### Patch Changes

- 729cbf7: Security dependency bumps to clear HIGH-severity `bun audit` findings: `esbuild` (cli, arbitrary file read), `kysely` pin (JSON-path injection), `@modelcontextprotocol/sdk` (mcp, transitive fast-uri/path-to-regexp/qs/ip-address/@hono-node-server fixes). Root `overrides` added for `picomatch`, `fast-uri`, `path-to-regexp`, `ws`, `qs`, `@hono/node-server`, `ip-address`, `postcss`, `js-yaml` to pin fixed versions where no direct-dep bump reaches them. No source changes.

## 7.0.2

### Patch Changes

- cbedcb5: Route the reorg cursor timestamp through `::text` before the `timestamptz` cast. A bare `::timestamptz` made the driver infer the param as a timestamp and convert it client-side at millisecond precision, silently discarding the microseconds the cursor exists to preserve.

## 7.0.1

### Patch Changes

- Fix infinite reorg re-delivery pinning subgraphs at a fork point. The `/v1/streams/reorgs` resume cursor now carries microsecond-precision `detected_at` text plus an id tiebreak (a millisecond-truncated cursor re-matched the row it came from every poll), and the subgraph reorg poller skips reorg ids it has already applied so a re-delivered reorg can no longer abort in-flight catch-up.

## 7.0.0

### Major Changes

- Remove `HiroClient.getTransaction`, `.fetchChainTip`, `.isHealthy`, and the `HiroTransaction` type — dead code with zero production callers (the x402 reconciler `getTransaction` was allegedly used by is Hiro-free by design; `fetchChainTip`'s one caller now uses `@secondlayer/stacks`'s `getBlockHeight`; `isHealthy` was never called).
- `StacksNodeClient.getInfo`, `.getContractAbi`, and `.getBlock` now delegate to `@secondlayer/stacks`'s transport/actions instead of hand-rolled `fetch()` calls — same public signatures and behavior (no retries, per-call timeouts preserved), but errors are now properly thrown on non-2xx responses instead of occasionally passing a 404 error body through as if it were valid data.

  **Breaking**: `StacksNodeClient.getContractSource` is removed — it had exactly one caller (the indexer's contract registry), which now calls `@secondlayer/stacks`'s `getContractSource` action directly.

### Patch Changes

- Updated dependencies
  - @secondlayer/stacks@2.14.1

## 6.41.3

### Patch Changes

- bb550ea: `subgraphs` gains a `sandbox_workers BOOLEAN NOT NULL DEFAULT FALSE` column (migration 0109) — the per-subgraph opt-in for a future sandboxed handler-execution path. Dark and wired to nothing in this release (default false everywhere); it exists as control-plane opt-in prep. See `docs/internal/security/subgraph-processor-sandbox-spike.md` §10.
- Updated dependencies
  - @secondlayer/stacks@2.11.0

## 6.41.2

### Patch Changes

- db52ee6: `x402_payments` gains a `credited_at TIMESTAMPTZ` column (migration 0108) — the idempotency key for deposit crediting. Pre-existing non-pending deposit rows are backfilled to a non-null sentinel so a genuinely-uncredited confirmed deposit can be safely healed exactly once without risking a double credit on historical rows.

## 6.41.1

### Patch Changes

- Gate the 0107 burnchain migration to the chain plane.

## 6.41.0

### Minor Changes

- 4c0e433: Burnchain reward tables drop the vestigial `canonical` column (migration 0107). Replace-per-height is now the documented reorg contract for `burn_block_rewards` / `burn_block_reward_slots`, and `sl index codegen` no longer emits `canonical` for them — if you generated a BYO-mirror schema containing these tables, re-run codegen and drop the column from your mirror (it was never set false, so no data is lost). The contracts registry canonical contract is now enforced: a reorg flips `contracts` rows at/above the fork height non-canonical (re-canonicalized automatically when the deploy is re-discovered on the new fork), and `getContract` / `GET /v1/contracts/:contractId` no longer serve reorged-out contracts.

## 6.40.1

### Patch Changes

- Gate the reindex-notify accounts migration to the control plane only.
- Updated dependencies
  - @secondlayer/stacks@2.10.0

## 6.40.0

### Minor Changes

- Add `notify_reindex_complete` account column (opt-out toggle for the subgraph reindex-completion email, defaults `true`) and `estimatedEvents`/`processedEvents`/`etaSeconds` to `SubgraphSyncInfo`, plus `estimatedEvents` to `DeploySubgraphResponse` — the fields that power the CLI/dashboard reindex ETA.

## 6.39.0

### Minor Changes

- Add `ChainWebhookDelivery`, a discriminated union typing the exact wire body of a chain-subscription webhook delivery (`{ type, timestamp, data }`), keyed on `data.trigger`. Covers all 18 trigger types plus `chain.reorg.rollback` and `chain.test.apply`, derived directly from the emit code rather than the unrelated Streams/Index event shape a prior integration mistakenly matched against — e.g. `print_event` deliveries carry `event.type: "contract_event"` (not `print_event_event`) and a `contract_identifier` field (not `contract_id`), NFT events carry only `raw_value` with no decoded `value`, and mint/burn events omit the inapplicable `sender`/`recipient` key entirely rather than sending `null`.

## 6.38.0

### Minor Changes

- 69c50cc: Add the `sbtc_withdrawal_swept_confirmed` webhook: fires once when a peg-out's committed BTC sweep crosses the confirmation threshold on Bitcoin. New `t.sbtcWithdrawalSweptConfirmed()` trigger + `SbtcWithdrawalSweptConfirmedEvent` payload, emitted by a scan-based evaluator path (`emitSbtcSettlementOutbox`) on its own `last_settlement_scan_at` cursor — forward-only (`confirmed_at > sub.created_at`), idempotent via the outbox dedup key (no double-fire on a reorg→un-confirm→re-confirm).

### Patch Changes

- 6e570ea: Add the `sbtc_settlements` table (migration 0104) + `SbtcSettlementsTable` schema type for the sBTC withdrawal BTC L1 settlement confirmer.

## 6.37.1

### Patch Changes

- 1522e90: Paginate the subscriptions list endpoint (default 50, max 200).

  `GET /api/subscriptions` now accepts `_limit` (1–200, default 50) and `_offset` (default 0) query params. Previously the endpoint fetched every subscription row for the account with no LIMIT. The `listSubscriptions` query in `@secondlayer/shared` accepts an optional `{ limit, offset }`; pagination applies only when provided, so existing internal callers (quota count, trigger matcher) remain unbounded.

- Updated dependencies [5dfd9f0]
- Updated dependencies [ef887b2]
  - @secondlayer/stacks@2.8.0

## 6.37.0

### Minor Changes

- `IndexHttpClient.walkEvents` accepts an opt-in `withTx` flag that requests submitting-transaction context on each event row (`tx_sender` / `tx_type` / `tx_status` / `tx_contract_id` / `tx_function_name`) via the Index API's new `tx_context=true`. Lets an event-scoped consumer build transaction context without a separate transactions fetch.

## 6.36.0

### Minor Changes

- Rename the decode plane off the `l2`/`layer2` naming (collides with the blockchain layer model — Bitcoin L1 / Stacks L2).

  - **shared**: DB schema type `l2_decoder_checkpoints` → `decoder_checkpoints` (and `L2DecoderCheckpointsTable` → `DecoderCheckpointsTable`); new migration `0103` renames the table and re-keys checkpoint names `l2.* → decode.*` in place (non-destructive — preserves cursors, no re-decode). Run migrations before booting the decoder. The internal Streams key/tenant defaults change to `sk-sl_streams_decode_internal` / `tenant_streams_decode_internal`.
  - **subgraphs**: streams-index block source falls back to the renamed internal Streams key default.
  - **sdk**: correct the webhook-verify JSDoc — issued signing secrets are bare 64-char hex (not `whsec_`-prefixed); `verifyWebhookSignature` handles both, but a generic Svix/Standard-Webhooks library will mis-base64-decode a bare-hex secret.

  Deploy note: the internal default key changed, so recreate api + decoder + subscription-processor together (a partial rollout 401s the decode reader until consistent).

## 6.35.1

### Patch Changes

- x402 payment ledger persists `credit_usd_micros` so the reconciler can credit slow-confirming deposits; `sl billing` status now shows the real free-tier limits instead of a "no limits" message.

## 6.35.0

### Minor Changes

- 543f0a4: Add optional fields to `SubgraphSummary`: `totalRows`, `lastError`, `lastErrorAt`, `updatedAt`, and `subscriptionCount` (powers the console subgraph cards' freshness, error surfacing, and subscription counts). All additive and optional, non-breaking.

### Patch Changes

- Updated dependencies [543f0a4]
  - @secondlayer/stacks@2.5.2

## 6.34.0

### Minor Changes

- efa0e13: Add sBTC webhook trigger types and PoX reward-cycle aggregates.

  **shared**: 4 new `ChainTrigger` discriminated union members — `sbtc_deposit`, `sbtc_withdrawal_create`, `sbtc_withdrawal_accept`, `sbtc_withdrawal_reject` — each with typed filter schemas. New `SbtcDepositEvent` and `SbtcWithdrawalEvent` envelope interfaces exported from `chain-envelopes`.

  **subgraphs**: Trigger evaluator now processes sBTC events from `sbtc_events` table (separate query path from `decoded_events`). `emitSbtcOutbox` matches active chain subscriptions against canonical sBTC events per block and writes to `subscription_outbox`.

  **api**: `/v1/index/pox/cycles` and `/v1/index/pox/cycles/:reward_cycle` — paginated PoX-4 reward-cycle aggregates (total ustx locked, unique stackers/delegators, per-function breakdown, `is_current` flag). 30s cache for current cycle, 1h for completed.

## 6.33.3

### Patch Changes

- add account_credits migration and table types

## 6.33.2

### Patch Changes

- fd06663: Fail loud on boot when the webhook signing key is absent — the subscription-processor now refuses to start in prod (unless `ALLOW_UNSIGNED_WEBHOOKS=true`) rather than silently shipping unsigned deliveries

## 6.33.1

### Patch Changes

- d78cd51: fix: x402 payment confirmation queried `decoded_events` with the bare broadcast txid, but the index stores `tx_id` `0x`-prefixed — so every confirmation silently failed. Optimistic payments reverted after the grace window and struck the payer (downgrading legit users to confirmed-tier); confirmed-tier deposits/deploys never confirmed. Add `toIndexTxId()` to `@secondlayer/shared/x402` and apply it in the reconciler (`defaultIsCanonical`) and the confirmed-tier verifier (`verifyTransferByTxId`).

## 6.33.0

### Minor Changes

- e27d752: live walk promotes status toward active but never overwrites a "reindexing" park — per-block status stamping let catch-up flap a parked subgraph back into its own path, fighting the queued reindex op

## 6.32.0

### Minor Changes

- ab8360d: backfill ops get their own crash checkpoint (cursor_block): written blocks advance it conditionally in the same transaction, replays skip, lost races roll back as skips, requeues inherit the committed prefix, and backfill walks never touch the live subgraph cursor. RELEASE NOTE: subgraphs + api must deploy in the same train (op-cursor enqueue semantics).
- 05b1b12: empirical print-event schema inference: GET /v1/index/contracts/:id/print-schema derives per-topic payload schemas (exact Clarity types from raw_value, presence rates) from indexed history; `sl subgraphs create --from-contract` scaffolds typed defs with prints maps + nullability comments (--table-per-topic for normalized layout); `sl subgraphs codegen --payloads` emits per-topic .d.ts; deploys warn on handler fields never observed for a source's topics; SDK index.printSchema + MCP index_print_schema; prints accepted by filter validation

## 6.31.0

### Minor Changes

- db40071: operation weight classes: claim query budgets heavy (broad) syncs and rank-orders by plan after per-account fairness; light contract-scoped syncs flow past queued whales; sparse helpers exported
- 8ac70d7: queue visibility: approximate queue position + event-based progress denominators + ETA on subgraph status (API sync block + CLI rendering); progress flush writes processed_events per operation
- aef3e54: Hosted LLM surfaces removed (Sessions + command-palette agent). Bring your own agent harness via MCP/skills/prompts instead. `chat_sessions`/`chat_messages` tables dropped (migration 0097); `POST /me/meter` endpoint and the `ai_evals` Stripe meter removed.

### Patch Changes

- 9ee7879: tip-first deploys: backfillMode "concurrent" (CLI --tip-first) goes live at chain tip immediately and backfills history via a non-destructive background op; breaking redeploys refused pre-mutation; sync integrity reports history_filling while the op runs

## 6.30.0

### Minor Changes

- 6fcd653: GENESIS_BACKFILL_REQUIRES_PLAN error code; deploy response carries start_block + start_block_clamped
- 0449af7: wallet_principal on accounts + expires_at on subgraphs (x402-paid deploys), updateSubgraphExpiry query
- 5dc8fb3: sparse reindex: empty-match batches probe the next matchable height (contract-scoped) and leap there; boot-time sweep re-enqueues reindexes stranded by a processor restart; IndexHttpClient.firstEventHeight probe
- 3def7d4: x402_payments.account_id (wallet→account continuity) + month-bucketed spend counters on x402_balances
- 38dad1c: x402_balances table + x402_payments.kind (prepaid credit)

## 6.29.0

### Minor Changes

- 051bbc5: Ghost accounts schema (migration `0093_ghost_accounts`): `accounts.ghost` boolean flag + `accounts.email` made nullable (the plain UNIQUE constraint stays — Postgres unique ignores NULLs, so `ON CONFLICT (email)` upserts are unaffected), new control-plane `claim_tokens` table (hashed one-time tokens that attach an email to a ghost account via the magic-link flow), and a `GHOST_KEY_READ_ONLY` → 403 mapping in `CODE_TO_STATUS`. Backs the anonymous self-serve key mint (`POST /v1/keys`).
- cf8c86d: Subgraph visibility + open /v1 read surface. New managed deploys default `public` — anon-readable at `/v1/subgraphs/:name/:table` with the standard cursor envelope (`{ rows, next_cursor, tip }`), wildcard CORS, and anon rate limits; BYO-database deploys default `private` (reads require the owning account's `sk-sl_` key; anon resolution 404s). Public names are a single global namespace claimed on publish (409 `PUBLIC_NAME_TAKEN` on collision). CLI: `sl subgraphs deploy --visibility`, `sl subgraphs publish|unpublish`. SDK: `subgraphs.publish()/unpublish()/rows()`. MCP: `visibility` on `subgraphs_deploy`, new `subgraphs_publish`/`subgraphs_unpublish` tools. Shared: `subgraphs.visibility` column (migration 0092), deploy schema field, `PUBLIC_NAME_TAKEN` error code.
- 8253e67: x402 rail: add HTTP 402 to the error system — `PAYMENT_REQUIRED` code + `402` in `CODE_TO_STATUS`, a `PaymentRequiredError` carrying the challenge in `details`, and the `x402_payments` control-plane ledger (migration `0091`, `Database` type, `TABLE_TO_DB` registration).
- fb7acf4: Add `@secondlayer/shared/x402`: the x402 payment-rail token set (STX, sBTC, USDCx — mainnet ids/decimals/asset-identifiers, all confirmed on-chain) and CAIP-2 network ids, single-sourced for the SDK/MCP client and the API facilitator.

### Patch Changes

- 0640e37: Make migration `0090_events_streams_filter_idx` timeout-safe: lift `statement_timeout` for the index-build transaction so a fresh deploy completes instead of hard-failing with error 57014 on the large `events` table. On prod the indexes are still pre-created `CONCURRENTLY` (the migration no-ops via `IF NOT EXISTS`), so no write-lock is held there.
- 6c6d2c9: x402 optimistic finality tier (Sprint B): Index/Streams now serve **near-instant** on broadcast-accept (the node admitting the sponsored tx to its mempool), reconciling asynchronously, instead of blocking ~5–29s for canonical confirmation. Gated per-principal by an optimistic gate (`x402/optimistic-gate.ts`) — a fixed-window velocity cap plus a reputation strike counter — that **fails closed** to confirmed-tier; high-value surfaces can stay `confirmed`. `settlePayment` gains a broadcast-no-await mode (`state: "optimistic"`), the catalog carries per-surface `finality` (Index/Streams default optimistic), and the worker reconciler now advances `pending → confirmed | reverted` and records a strike (shared Redis key, `x402StrikeKey`) on revert so repeat droppers lose optimism. Reconciliation confirms against our own indexed `decoded_events` (canonical-gated) — the same substrate the confirmed-tier serve verifies against — so it's self-contained / RPC-free. The SDK's `X402Receipt` now carries the settlement `state` (`optimistic` | `confirmed`).
- 2e52a78: Wire the x402 rail onto live surfaces (Sprint 4), gated on `X402_SPONSOR_KEY` so it's a no-op until the sponsor wallet is funded. When live: Streams becomes keyless-but-paid (accountless callers pay per call via x402; keyed callers bypass — `streamsBearerAuth` anon fall-through + anon-tolerant rate-limit/retention) and Index's anon path is x402-gated. Adds `GET /x402/supported` (self-hosted capability + price catalog, no external Bazaar), `HiroClient.getTransaction`, and a worker cron (`x402-reconcile`, 5-min sweep over the last hour) that flips post-serve-reverted ledger rows.
- Updated dependencies [49ce0e9]
- Updated dependencies [8f2de58]
- Updated dependencies [389976a]
  - @secondlayer/stacks@2.5.0

## 6.28.1

### Patch Changes

- c2e4caa: Fix the Streams read-path hot spot. Add chain-plane indexes on `events` for the firehose payload filters — `(block_height, type)` plus partial expression indexes on `data->>'sender'`, `data->>'recipient'`, and `data->>'asset_identifier'` (partial `IS NOT NULL` so an equality filter provably uses them regardless of `types=`). Replace the per-row correlated `COUNT(*)` that computed each event's per-block `stream_event_index` (O(rows × block_events) across all four Streams read paths) with a single `ROW_NUMBER()` window over the block's all-types event set — byte-identical ordinals, so the cursor-stability contract (an event's `stream_event_index` is the same with or without filters) is preserved and now covered by a dedicated test. Build the indexes with `CREATE INDEX CONCURRENTLY` in prod before deploy (the migration is `IF NOT EXISTS` no-op there).

## 6.28.0

### Minor Changes

- 4037871: Subscriptions agent parity: expose `authConfig` (bearer receiver auth) on `subscriptions_create`/`subscriptions_update`, `name` (rename) on `subscriptions_update`, and `force` (idempotency suffix to re-run an already-replayed range) on `subscriptions_replay` + the SDK `replay()`. Add `CHAIN_TRIGGER_FIELDS` (derived from `ChainTriggerSchema`, never drifts) in shared and a `secondlayer://chain-triggers` MCP resource listing the filter fields each chain-trigger type accepts.

### Patch Changes

- Updated dependencies [fbdd5ae]
  - @secondlayer/stacks@2.4.0

## 6.27.0

### Minor Changes

- bbd40f7: Add `ByoBreakingChangeDetails` interface and map `BYO_BREAKING_CHANGE` code to HTTP 422.

## 6.26.0

### Minor Changes

- 62e4d90: Add `SubgraphAggregateParams` and `SubgraphAggregateResponse` types for the subgraph aggregate query API (count/countDistinct as numbers, sum/min/max as lossless strings).

## 6.25.0

### Minor Changes

- 3a7f8a2: Export typed chain-subscription webhook envelopes. `ChainApplyEnvelope`, `ChainReorgRollbackEnvelope`, `ChainReorgOrphanedEntry`, and the `ChainWebhookEnvelope` union are now single-sourced in `@secondlayer/shared` (the subgraphs producer uses them) and re-exported from `@secondlayer/sdk`, so webhook consumers can type the `chain.*.apply` / `chain.reorg.rollback` bodies they receive instead of reading code.
- 14657ae: `SecondLayerError` (and `AuthorizationError`) now accept an optional structured `details` payload, surfaced in `toJSON()` so HTTP error handlers can emit machine-readable hints alongside the message.
- 3a57c08: Add `SOURCE_READ_TYPES` (portable column type per read column) and `SOURCE_READ_PKS` (primary key per read table) — both single-sourced from the `Database` interface and drift-tested against `SOURCE_READ_COLUMNS`. These power typed codegen for the public Index domain (`SOURCE_READ_PKS` gives Prisma a model identity; tables with only a synthetic-id PK excluded from the read contract map to `null`).
- af82681: Add `SubscriptionTestResult` type for the subscription test-delivery endpoint.

## 6.24.0

### Minor Changes

- c171351: Add trustless transaction-inclusion proofs.

  `@secondlayer/shared/node/nakamoto` parses Nakamoto block headers and recomputes the block_hash, index_block_hash, and tx_merkle_root the chain commits to; `@secondlayer/shared/node/consensus` verifies a header's signer signatures against the reward cycle's signer set. The SDK adds `verifyTransactionProof` (anchored + consensus levels) and `fetchRewardSet`, letting a consumer confirm a transaction's inclusion in a block — and that ≥70% of signer weight attested to that block — without trusting Secondlayer.

## 6.23.0

### Minor Changes

- 434c947: Promote the Postgres advisory-lock leader-election util to `@secondlayer/shared/leader` (`withLeaderLock`, `createPostgresLeaderBackend`, lock-key constants) so the subscription evaluator, chain-reorg handler, and subgraph catch-up can share one fleet-wide election primitive with the indexer. `createPostgresLeaderBackend(url?)` now accepts an explicit lock-DB URL — required after the source/target split, since control-plane state (subscriptions, subgraphs) lives on the target DB and a lock on the default source DB would guard nothing. Adds distinct `SUBSCRIPTION_EVALUATOR_LOCK_KEY` and `SUBGRAPH_CATCHUP_LOCK_KEY` keys.
- eccd246: Sign the Streams cold-bulk parquet manifest with ed25519, closing the trust gap between the live and bulk availability lanes. The bulk manifest carried only per-file sha256, so a tampered manifest+file pair verified cleanly — the SDK threw a signature error on hash mismatch, overstating the guarantee. The exporter now signs each manifest with the platform Streams key (`STREAMS_SIGNING_PRIVATE_KEY`) over its canonical bytes (the manifest JSON minus the `signature`/`key_id` envelope), and a one-shot backfill script re-signs existing manifests in R2 (latest + history). New `@secondlayer/shared/streams-bulk-manifest` exports `signStreamsBulkManifest` / `verifyStreamsBulkManifestSignature` / `canonicalStreamsBulkManifestPayload`. Signing is a no-op when no key is set, and the `signature`/`key_id` fields are optional, so legacy unsigned manifests still parse — the SDK-side verification ships separately and stays default-off until the backfill has run.
- 61ef1d4: Sign every subscription webhook with a universal ed25519 signature, regardless of body format. Previously only the `standard-webhooks` format carried an HMAC; `raw`, `cloudevents`, `trigger`, `cloudflare`, and `inngest` deliveries carried no Secondlayer proof, so a receiver had no way to verify a payload came from us. Each delivery now also gets `webhook-id` + `X-Secondlayer-Signature` (ed25519 over `${webhook-id}.${body}`) + `X-Secondlayer-Signature-KeyId`, signed with a single platform key (`SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY`, falling back to the existing `STREAMS_SIGNING_PRIVATE_KEY`). Body shapes stay format-specific. Receivers verify with the new `verifySecondlayerSignature(rawBody, headers, publicKeyPem)` SDK helper against the published public key — no per-subscription secret. Signing is a no-op when no key is configured, so it is safe to ship before the key is provisioned. Also publishes `@secondlayer/shared/crypto/ed25519` as an importable subpath.

## 6.22.0

### Minor Changes

- ebbb6b0: Make `migrate.ts` split-aware. `migrationTargets()` now tags each database with a plane role (`source` / `target` / `both`) and `setMigrationRole()` is set before each pass; new helpers `onControlPlane()` / `onChainPlane()` (exported from `@secondlayer/shared/db`) gate DDL inside a migration so control-plane DDL no-ops on the SOURCE (chain) DB — where those tables were dropped post-cutover — and chain DDL no-ops on TARGET. Single-DB / collapsed-split mode resolves to role `both` and is unchanged. Every migration still runs on every DB (kysely integrity preserved); only the DDL is gated.
- 9f4619d: Add `TABLE_TO_DB` (exported from `@secondlayer/shared/db`) — a canonical, type-enforced (`satisfies Record<keyof Database, "source"|"target"|"both">`) registry mapping every table to its plane in the source/target split. It's the single source of truth that `docker/SCHEMA_SPLIT.md` and the cutover script's `CONTROL_TABLES` mirror, guarded by a drift test.

## 6.21.0

### Minor Changes

- b1366b3: Make the LISTEN/NOTIFY listener split-aware. Export `sourceListenerUrl()` / `targetListenerUrl()` from `@secondlayer/shared/queue/listener` and bind the subscriptions emitter (`subscriptions:new_outbox` / `subscriptions:changed`) to the TARGET DB where those channels fire. Previously the emitter passed no connection string and fell back to `DATABASE_URL`, crashing the subgraph-processor under the active source/target split when `DATABASE_URL` was unset. The subgraph-processor's block/reorg/operation listeners now share the same shared helpers (dedup).

## 6.20.0

### Minor Changes

- 8c7c24c: Surface the chain/control DB split state so its dormancy in prod is visible, not silent: add `getDbSplitStatus()` (source/target host+db, no credentials) exposed on the API `/status` and `/public/status` responses; extend `assertDbSplit()` to warn on a dormant single-failure-domain in prod and error when a split var is unset with no `DATABASE_URL` fallback (the silent wrong-DB case); wire `assertDbSplit()` into the worker and subgraph-processor entrypoints

### Patch Changes

- a199aeb: `IndexHttpClient` now retries transport failures (connection refused/reset) and gateway statuses (502/503/504) with bounded exponential backoff. Makes a single api-replica recreate transparent to the streams-index subgraph-processor / l2-decoder, closing the processors-depend-on-api coupling once the API runs N>1 replicas behind Caddy
- b10a67b: Treat an empty-string SOURCE\_/TARGET_DATABASE_URL (passed through docker-compose as "") as unset in the LISTEN/NOTIFY and subgraph-cache paths — `||` instead of `??` — so single-DB mode falls back to DATABASE_URL instead of crashing the subgraph processor

## 6.19.0

### Minor Changes

- 173340a: Support the chain/control-plane database split: migrate every configured database (source + target), and add an assertDbSplit boot guard that warns when SOURCE\_/TARGET_DATABASE_URL collapse to one DB. No behavior change in single-DB mode (DATABASE_URL only)
- e9d4594: Re-source the PoX-4 stacking decoder over the public Index HTTP API (removing its source-DB coupling), serve burn_block_height on /v1/index/transactions, and enable the stacking decoder by default (set POX4_DECODER_ENABLED=false to opt out; POX4_BACKFILL_FROM_HEIGHT bounds the backfill scan)
- cc75ef3: Single-source the firehose DB event-type vocab (STREAMS_DB_EVENT_TYPES + label maps) in @secondlayer/shared; indexer consumes it instead of a local copy
- 6b11c2a: Add DbReadRow driver-accurate read-row type and SOURCE_READ_COLUMNS map, declaring the indexer→API source-table read contract with a CI drift guard

## 6.18.0

### Minor Changes

- 80433eb: Consolidate the decoded event-type vocabulary into a single `@secondlayer/shared` source (`DECODED_EVENT_TYPES`, `STREAMS_EVENT_TYPES`, and the now-exported `CHAIN_TRIGGER_TYPES`), replacing the duplicate literal copies in the SDK, indexer, and MCP tools. The MCP context resource now generates its `whatYouCanDo` capability list from the live tool registry, so it can no longer drift behind the actual tool surface.
- 22725d0: Expose subgraph operation status so agents can poll a reindex/backfill to completion instead of guessing. `reindex`/`backfill`/`stop` already return an `operationId`; now `GET /api/subgraphs/:name/operations/:id` returns that operation's live status (kind, status, processed blocks, a derived 0–1 progress, error, timestamps), and `GET /api/subgraphs/:name/operations` lists recent operations. Surfaced as `sl.subgraphs.getOperation(name, id)` / `sl.subgraphs.operations(name)` (SDK) and the `subgraphs_operation` MCP tool. Backed by the existing `subgraph_operations` table — no migration.

## 6.17.0

### Minor Changes

- bb96d3f: feat: `trigger.*` chain-subscription builders + MCP chain support

  Expose ergonomic chain-trigger builders for direct chain-level subscriptions from the SDK root, and let the MCP `subscriptions_create` tool create chain subscriptions.

  - SDK now exports `trigger` (`import { trigger } from "@secondlayer/sdk"`) with one builder per event type (`trigger.contractCall`, `trigger.ftTransfer`, …), plus the `ChainTrigger` / `SubscriptionKind` types. Use as `subscriptions.create({ triggers: [trigger.contractCall({ ... })] })`. Raw `triggers` objects still work. (Renamed from the previously-unreachable `on` export to avoid colliding with `@secondlayer/stacks`'s subgraph-source `on`.)
  - MCP `subscriptions_create` accepts a `triggers` array (chain subscription) as an alternative to `subgraphName`/`tableName` (subgraph subscription).

## 6.16.0

### Minor Changes

- 56bc457: feat: direct chain-level subscriptions (webhooks on chain events, no subgraph)

  Subscriptions are now polymorphic: a `subgraph` subscription fires on a deployed subgraph's table rows (unchanged), or a new `chain` subscription fires on raw chain events directly — a webhook on a contract / event-type / function-call, or any SIP-010/SIP-009/custom trait — with no subgraph to deploy.

  - SDK: `subscriptions.create({ triggers: [...] })` plus `on.*` trigger builders (`on.contractCall`, `on.ftTransfer`, …). New `ChainTrigger` / `SubscriptionKind` types; `SubscriptionDetail` gains `kind` + `triggers`.
  - Built on the public Index/Streams clock (reuses the subgraph re-point's `PublicApiBlockSource` + matcher); forward-looking (starts at tip, never backfills).
  - Reorg-safe apply/rollback delivery envelope (`chain.{type}.apply` / `chain.reorg.rollback`); per-subscription HMAC signing and all delivery formats reused unchanged.
  - Trait-scoped triggers require the contract registry (`CONTRACT_REGISTRY_ENABLED=true`).

## 6.15.0

### Minor Changes

- 7fc3cf9: Add an internal Index read credential (`@secondlayer/shared/index-internal-auth`), seeded into the Index token store as an unmetered enterprise tenant (no `account_id`). Lets first-party consumers — the subgraph processor — read `/v1/index` over HTTP without self-metering. Resolves from `INDEX_INTERNAL_API_KEY`.
- 0b87582: Add `@secondlayer/shared/index-http` — a minimal cursor-paginated transport for the public Index (`/v1/index`) + Streams clock (`/v1/streams`) APIs, plus the Index wire-row types. Lives in `shared` (a leaf both the SDK and the subgraph runtime depend on) so the wire format has a single home and no package cycle.

## 6.14.1

### Patch Changes

- 9e3223b: Fix O(n²) keyset pagination on `/v1/index/events` for bare event-type sources. Adds a `(event_type, block_height, event_index)` partial composite index (migration 0087) and rewrites the cursor predicate to the sargable row-values tuple form `(block_height, event_index) > (X, Y)`. Without both, the non-sargable `OR` keyset made the planner bitmap-scan the entire event-type partition on every page (e.g. ~4.2M `print` rows, ~6.8s/page); it is now an index-only range scan (~0.37ms/page).

## 6.14.0

### Minor Changes

- 4b96a8a: Add mempool (pending transactions) to the Index API.

  The indexer now persists unconfirmed transactions from the Stacks node's `/new_mempool_tx` observer callback (deriving the txid from raw_tx), evicts them on confirmation (block ingest) or drop (`/drop_mempool_tx`), and sweeps stuck rows. The Index API serves them at `GET /v1/index/mempool` (filter by `sender`/`type`, cursor-paginated) and `GET /v1/index/mempool/:tx_id` — full pending-transaction documents (fee/nonce/post-conditions decoded from raw_tx), minus the block-anchored fields, plus `received_at`. Mempool reads are never cacheable (volatile). New SDK client: `index.mempool` (`list`/`walk`/`get`).

## 6.13.0

### Minor Changes

- 982f2bb: Add a wrong/empty Postgres volume guard. `checkChainDataIntegrity` flags the case where the chain tip is high but the deep history it implies is missing — the signature of a container recreated against a fresh/empty data dir. The indexer logs a loud `DB INTEGRITY ALERT` on startup (fail-closed with `REQUIRE_INTEGRITY=true`), and `/public/status` now reports `chainIntegrity` and degrades the top-level status on failure (without marking a core service down). Closes the blind spot where the DB read "healthy" on freshness while serving an empty volume.

### Patch Changes

- 3b56393: Fix `ArchiveReplayClient.replayGaps` crashing on large backfills. It computed the max target height with `Math.max(...gapHeights)`, which spreads the entire gap set as call arguments — a full-history backfill (millions of heights) hit the call-stack limit and threw `RangeError` instantly. Now computes the max by iteration, and samples unmatched heights without spreading the whole set.

## 6.12.0

### Minor Changes

- a930331: Add opt-in payload validation with a dead-letter log on ingest. When `STREAMS_PAYLOAD_VALIDATION=true` (default off), each event's decoded payload is checked against the minimal shape its type requires; malformed payloads are recorded in a new `dead_letter_events` table (migration 0085) with a reason. The event itself is still persisted — chain data is never dropped — so this is a diagnostic log, not a gate. Default-off keeps the ingest hot path lean.

## 6.11.0

### Minor Changes

- 0fab6c1: Preserve reorged rows instead of destroying them. On a reorg that reuses a height with a new block hash, the indexer now copies the orphaned transactions/events into new `transactions_archive` / `events_archive` tables (migration 0084) before replacing the height, tagged with the displaced block hash. The main tables stay canonical-only so all readers are unaffected, while the raw log is preserved and queryable — honoring the immutable-log guarantee. A redelivery of the same block is not a reorg and is not archived.
- bfa74db: Centralize the Streams cursor codec in `@secondlayer/shared` (`encodeStreamsCursor`, `decodeStreamsCursor`, `EMPTY_RANGE_EVENT_INDEX_SENTINEL`). The API and indexer now delegate to one implementation instead of three near-identical copies, so encode/decode and the empty-range sentinel can't drift between products.
- b03c049: Add an ed25519 signing module (`@secondlayer/shared` `ed25519`): `sign`/`verify`, PEM key loaders, keypair generation, public-key derivation, and a stable key id. Asymmetric so consumers verify with a published public key, no shared secret. Backs Streams response proofs.
- c8e7c41: Add burn-block-anchored finality helpers. `@secondlayer/shared` exposes `DEFAULT_BTC_CONFIRMATIONS` + `finalizedBurnHeight()`, and the indexer adds `getFinalizedStacksHeight()` to map the burn-confirmation boundary to the highest finalized Stacks height. Post-Nakamoto finality is anchored to Bitcoin confirmations rather than a fixed Stacks-block lag.

## 6.10.0

### Minor Changes

- 96fd583: Add the burnchain rewards dataset: Bitcoin PoX reward payouts and reward-set membership, indexed from the stacks-node `/new_burn_block` event. Served at `/v1/datasets/burnchain/rewards` (filter by `recipient`) and `/v1/datasets/burnchain/reward-slots` (filter by `holder`), cursor-paginated by burn block height. New SDK clients `datasets.burnchainRewards` and `datasets.burnchainRewardSlots` (list/walk), and `sl datasets query burnchain-rewards`. Go-forward only.

## 6.9.0

### Minor Changes

- 0c3ba82: Add bring-your-own-database support to subgraphs. Deploy with `sl subgraphs deploy <file> --database-url <postgres-url>` to write a subgraph's schema, handler rows, and serving reads to your own Postgres while the managed pipeline still ingests, decodes, matches, and runs your handler. The connection string is stored encrypted at rest and never returned. Handler writes must be idempotent (insert/upsert); reindex is unavailable on BYO subgraphs (re-deploy to rebuild), and deleting a BYO subgraph never drops the schema in your database.
- 0c3ba82: Add ORM codegen and contract trait discovery.

  `sl subgraphs generate <file> --target prisma|drizzle` emits a typed ORM schema for a subgraph's tables — point it at your BYO database for a fully-typed Prisma/Drizzle client with relations (`@relation` / `relations()`), inferred row types, and FK constraints that mirror the deployed DDL. Kysely is supported via `kysely-codegen` against your database.

  Contract trait discovery adds a contract registry that statically classifies deployed contracts against SIP-009/010/013 (by ABI shape inference and declared `impl-trait`s) and exposes `GET /v1/contracts?trait=sip-010&conformance=declared|inferred|any` to find every conforming contract.

### Patch Changes

- Updated dependencies:
  - @secondlayer/stacks@2.3.0

## 6.8.1

## 6.8.0

### Minor Changes

- 81fc2d8: Index now decodes and serves Clarity `print` events. `GET /v1/index/events?event_type=print` returns each print's `topic`, the Clarity `value` decoded to JSON (uints as strings, buffers as `0x…` hex, tuples as objects), and the canonical `raw_value` hex — filterable by `contract_id`.

  SDK adds `decodePrint` / `isPrint` and the `DecodedPrint` types (depends on `@secondlayer/stacks` for Clarity decoding). A nullable `payload` JSONB column is added to `decoded_events` to hold decoded values that don't fit the flat transfer columns. The indexer runs a `print` decoder; the API registry and OpenAPI expose it.

## 6.7.0

### Minor Changes

- 74cf4a4: Remove account/billing modules from the public surface — db/queries (accounts, usage, account-spend-caps, projects) and schemas/accounts, relocated to an internal package. The schemas barrel no longer re-exports account schemas.

## 6.6.0

### Minor Changes

- d7b1ae2: Remove pricing and account-usage from the public surface (relocated to an internal package) and re-export the Database type from the db entry.

## 6.5.0

### Minor Changes

- 903a278: Remove unused internal exports from the public surface (tenant/provisioning queries, db/jsonb, schemas/filters, env, types, constants, crypto/hmac) and drop the dead provisioning-audit and tenant-compute-addons query modules.

## 6.4.5

### Patch Changes

- 229c297: Add license, repository, and homepage metadata plus a bundled LICENSE file; drop src from clarity-docs npm files.
- Updated dependencies:
  - @secondlayer/stacks@2.2.1

## 6.4.4

### Patch Changes

- ba36d64: Replace the waitlist/early-access gate with open signup. Any email can request a magic link and an account is created on verify. Removes the waitlist table, admin approval routes, and confirmation/approval emails.

## 6.4.3

## 6.4.2

### Patch Changes

- 69ef11a: subgraph deploy: detect handler-only changes, add ContractCallEvent type, remove version override flag

## 6.4.1

### Patch Changes

- 9f28cd2: Subscription delivery integrity fixes:

  - New migration `0077` loosens `subscription_deliveries.outbox_id` FK from `ON DELETE CASCADE` to `ON DELETE SET NULL`. Outbox cleanup races no longer 23503 the delivery insert, which previously snowballed circuit_failures and auto-paused subscriptions.
  - `sl subscriptions delete <name>` is now idempotent — a second delete prints "already deleted" instead of `500 Server error`.
  - `sl subscriptions get` now shows the backoff curve (30s → 2m → 10m → 1h → 6h → 24h → 72h) alongside Max Retries / Timeout / Concurrency.

## 6.4.0

### Minor Changes

- f3ca84e: Drop `"dedicated"` from the `InstanceMode` union and remove `isDedicatedMode()`. The shared-rip pivot has been live for two days; nothing references the dedicated branch in source. Delete unused `db/queries/tenants.ts`. Add migration 0076 marking the `tenants` table deprecated (data preserved for one observation window; a follow-up migration will DROP).

### Patch Changes

- 31d029b: Add migration 0075 — restores `subgraphs` + `subgraph_operations` on platform DBs that lost them during the shared→dedicated cutover. Idempotent; no-ops on OSS, fresh dev, and dedicated tenant DBs that still have the tables. Fixes the post-2026-05-14 shared-rip regression where `subgraph-processor` crash-loops on `relation "subgraphs" does not exist`.

## 6.3.5

### Patch Changes

- 807b3e7: Add `service_heartbeats` table (migration 0074) — long-running services (subgraph-processor, decoders) upsert a row every 30s so the platform can surface their liveness without docker introspection.

## 6.3.4

### Patch Changes

- 36d8e2b: Add `pgSchemaNameFor(accountId, name)` helper for account-scoped subgraph schema names.

## 6.3.3

### Patch Changes

- e1b68e9: fix subgraph delete 500-ing mid-reindex. Previously the route set `cancel_requested: true` and immediately ran `DROP SCHEMA ... CASCADE`, which blocked behind the live reindex transaction until the API socket timed out → generic 500. Adds `waitForSubgraphOperationsClear` (polls until active ops drain or 30 s timeout) and calls it after requesting cancel. The processor observes `cancel_requested` at batch boundaries (typically <5 s) and releases its row + advisory locks; DROP SCHEMA then proceeds cleanly. If the timeout elapses, the route logs a warning and proceeds anyway — preserves current behavior for the pathological case.

## 6.3.2

### Patch Changes

- 5cb9862: rebalance per-tenant container CPU + RAM split from `PG 50% / proc 30% / api 20%` → `PG 25% / proc 55% / api 20%`. Backfill throughput regressed massively in the move from shared infra to per-tenant containers because the proc only got 30% of plan CPU (0.6 CPU on Launch) while PG idled at <1% observed utilization. Live-tested on a Launch tenant: bumping proc from 0.6 CPU → 1.5 CPU took backfill from ~5 blocks/min to ~108 blocks/min (~21× speedup). New tenants get the new split automatically. Existing tenants need `docker update --cpus` or re-provision.

## 6.3.1

### Patch Changes

- 9a4c8d3: perf(events): expression index on `data->>'contract_identifier'`

  Print-event scans filtered by contract used to fall back to a sequential scan of the events table (53M+ rows on mainnet) — query took 2-3s at limit=100, 5-20s at limit=500, surfacing as `socket connection was closed unexpectedly` errors in the L2 BNS decoder. New partial expression index `events_contract_event_contract_id_idx` brings those queries to ~1ms via Index Scan.

  - `@secondlayer/shared@*`: ships migration `0073_events_contract_id_idx.ts` (`CREATE INDEX IF NOT EXISTS …`). The index was already applied to prod via `CREATE INDEX CONCURRENTLY` on 2026-05-09; the migration is a no-op there but seeds dev/staging.
  - `@secondlayer/api@*`: reverts the `Bun.serve idleTimeout: 60` workaround introduced 2026-05-09 — back to default. Indexed query no longer needs the extended timeout.

- Updated dependencies:
  - @secondlayer/stacks@2.2.0

## 6.3.0

### Patch Changes

- Updated dependencies:
  - @secondlayer/stacks@2.1.0

## 6.2.0

## 6.1.0

## 6.0.0

## 5.2.1

## 5.2.0

## 5.1.0

## 5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies:
  - @secondlayer/stacks@2.0.1

## 4.4.0

### Minor Changes

- f8645e8: Add generated subgraph API specs for OpenAPI, compact agent schemas, and Markdown docs across shared, SDK, CLI, and MCP surfaces.

## 4.3.3

### Patch Changes

- 1a3a80d: Harden tenant runtime environment injection, subgraph operation cleanup, subscription scoping, and destructive CLI error handling.

## 4.3.2

### Patch Changes

- [`2bb1f85`](https://github.com/ryanwaits/secondlayer/commit/2bb1f85fecd9774fbd34b17ff28e876094279208) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Clarify subgraph reindex status output with reindex-aware progress fields and CLI labels.

## 4.3.1

### Patch Changes

- Skip subgraph operation migration on control-plane databases without tenant subgraph tables.

## 4.3.0

### Minor Changes

- Move subgraph reindex and backfill lifecycle tracking into durable tenant operation records.

## 4.2.0

### Minor Changes

- Add CLI bearer-token subscription auth, deploy-time subgraph startBlock overrides, and MCP deploy startBlock support.

## 4.1.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@2.0.0

## 4.1.0

### Minor Changes

- Add the agent-native subscription golden path: shared subscription schemas, schema-aware API and CLI validation, first-class `sl subscriptions` lifecycle commands, MCP lifecycle parity, and updated subscription docs.

## 4.0.2

### Patch Changes

- [`de7f867`](https://github.com/ryanwaits/secondlayer/commit/de7f867fa5681df67f014c01a63df3428d122459) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Diagnostic: Kysely `log` hook logs failing SQL + params whenever postgres rejects with code 42P10 (ON CONFLICT target doesn't match a unique constraint). Temporary — will be reverted in a follow-up patch once the culprit query is identified in prod logs.

## 4.0.1

### Patch Changes

- Migration 0058 `down` now throws instead of silently re-adding the `ai_cap_cents` column without data. Matches the `0056` one-way-drop pattern.

## 4.0.0

### Major Changes

- Drop AI eval tracking, caps, and token pricing. Removes `ai_cap_cents` from `AccountSpendCapsTable`, deletes `AiUsage` / `getAiUsage`, `MODEL_PRICING` / `computeUsdCost` / `TokenUsage` / `ModelPricing`, and per-tier AI caps (`getAiCapForPlan`). Also drops the `@deprecated hashApiKey` alias. Migration 0058 drops the `ai_cap_cents` column.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@1.0.1

## 3.0.0

### Major Changes

- [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop workflow + sentry tables, query helpers, and schemas. Migration 0056 demolishes residual tables (`workflow_runs`, `workflow_steps`, `workflow_queue`, `workflow_ai_usage_daily`, `sentries`, `sentry_alerts`, `tx_confirmed_notify`).

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

- [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing foundation (Sprint A) — switch from 14-day trial to activity-based auto-pause, org-level billing prep.

  - Migration 0046 drops `tenants.trial_ends_at` + index, adds `tenants.last_active_at timestamptz NOT NULL DEFAULT now()` with index `(plan, last_active_at) WHERE status = 'active'`
  - Migration 0047 adds nullable `tenant_id` to `usage_daily` (+ best-effort backfill for single-tenant accounts), widens the unique key to `(account_id, tenant_id, date)` so Sprint-C Stripe metering can bill per-tenant
  - `TrialExpiredError` + `TRIAL_EXPIRED` code dropped (dead after trial removal)
  - New `bumpTenantActivity(slug)` + `listIdleHobbyTenants(idleSince)` query helpers
  - CLI drops trial-days-left from `sl instance info` and `sl whoami`, drops `TRIAL_EXPIRED` handlers

- [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing Sprint C.1 — decouple compute from plan for add-ons.

  - Migration 0048 adds `tenant_compute_addons` table. Each row = one add-on bundle (memory/cpu/storage deltas with optional effective window + Stripe subscription_item_id). Effective compute = plan base + SUM(active deltas).
  - New `@secondlayer/shared/db/queries/tenant-compute-addons` module: `listActiveAddonsForTenant`, `computeEffectiveCompute(tenantId, base)`.
  - `@secondlayer/provisioner` breaking changes:
    - `resizeTenant(slug, planId)` → `resizeTenant(slug, { plan, totalCpus, totalMemoryMb, storageLimitMb })`. Plan stays as a label; sizing is explicit.
    - `getTenantStatus(slug, plan)` → `getTenantStatus(slug, plan, storageLimitMb)`. Caller passes the effective storage limit from the tenants row.
    - `rotateTenantKeys` preserves existing container sizing by reading from `docker inspect` instead of recomputing from the plan — so it stays correct for tenants with add-ons.
    - `POST /tenants/:slug/resize` body shape: `{ plan, totalCpus, totalMemoryMb, storageLimitMb }`.
    - `GET /tenants/:slug` now reads `storageLimitMb` query param.
  - New exported `allocForTotals(totalMemoryMb, totalCpus)` from `packages/provisioner/src/plans.ts` — auto-biases to PG-heavy split below 1 GB, default split above.
  - Platform API `POST /api/tenants/me/resize` now composes plan base + active add-ons via `computeEffectiveCompute` before calling the provisioner. `tenants.cpus/memory_mb/storage_limit_mb` cache the effective values for dashboard + billing.
  - Add-on CRUD + Stripe wiring land in Sprint C.2/C.3; this sprint is data-model + plumbing only.

- [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Soft spend caps with 80% threshold alerts — the core anti-surprise-bill differentiator.

  - Migration 0050 adds `account_spend_caps` table (one row per account): monthly + per-line (compute/storage/ai) caps in cents, configurable `alert_threshold_pct` (default 80), `frozen_at`, `alert_sent_at`.
  - New `@secondlayer/shared/db/queries/account-spend-caps` module: `getCaps`, `upsertCaps`, `freezeAccount`, `clearFreeze`, `listFrozenAccountIds`.
  - Worker cron `spend-cap-alert.ts` runs daily: fetches each paid account's upcoming invoice, sends a Resend email at threshold, sets `frozen_at` at 100%. Alert email debounced per billing cycle via `alert_sent_at` comparison to `period_start`.
  - Compute + storage metering crons now read `listFrozenAccountIds` at the top of each tick and skip frozen accounts entirely. Capped accounts keep running but stop accruing billable usage until the next cycle.
  - Stripe `invoice.paid` webhook clears `frozen_at` + `alert_sent_at` on the paying account, unfreezing metering for the new cycle.
  - Session-authed dashboard endpoints `GET /api/billing/caps` + `PATCH /api/billing/caps`. Raising a monthly cap mid-cycle auto-clears an active freeze (user explicitly said "yes, bill more").

- [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Lay Stripe billing foundation on the platform control plane.

  - Migration 0049 adds nullable `accounts.stripe_customer_id` with a partial unique index (ignores NULLs so Hobby users stay out of Stripe entirely — customer records materialize on first upgrade).
  - New `setStripeCustomerId(accountId, id)` query helper + `stripe_customer_id` on the `Account` type.
  - Platform API gains a lazy Stripe SDK singleton (`packages/api/src/lib/stripe.ts`), webhook endpoint (`POST /api/webhooks/stripe`) with raw-body signature verification + audit trail, and session-authed billing routes (`POST /api/billing/upgrade`, `GET /api/billing/portal`) that lazy-create the Stripe customer on first upgrade and return Checkout/Portal URLs.
  - Idempotent setup script (`bun run stripe:setup` in `@secondlayer/api`) upserts one "Secondlayer" product, a Pro monthly price (`$25/mo`, lookup_key `secondlayer_pro_monthly`), and billing meters + metered prices for compute hours, storage GB-months, and AI eval overages. Enterprise remains custom-quoted per deal.
  - Docker `.env.example` documents the new env surface: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_METER_*`, `STRIPE_PRICE_*_OVERAGE`.

- [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Subscriptions CRUD surface — new `sl.subscriptions.*` client plus the DB schema + query helpers that back it.

  - SDK: `sl.subscriptions.create/list/get/update/delete/rotateSecret/pause/resume` with `CreateSubscriptionResponse` returning a one-time `signingSecret`.
  - Shared: Migration `0057_subscriptions` creates `subscriptions` + `subscription_outbox` + `subscription_deliveries` with the `subscriptions:new_outbox` notify trigger. Kysely types for all three tables. New `standard-webhooks` signing helper (matches Svix reference vectors). Subscription queries with encrypted signing secrets (reuses `crypto/secrets`).
  - OSS bootstrap: `SECONDLAYER_SECRETS_KEY` autogenerates to `.env.local` on first use when `INSTANCE_MODE=oss`.

  No delivery yet — the emitter worker + outbox draining lands Sprint 3. Platform-mode mirror table deferred to a follow-up.

### Patch Changes

- [`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop the marketplace-era columns from `subgraphs` (`is_public`, `tags`, `description`, `forked_from_id`) via migration `0045`. The columns were added by `0022_marketplace` and have been unused since the marketplace feature was removed in 2.1.0. Types updated accordingly.

- [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Subscription emitter lands — the end-to-end delivery loop.

  - `SubgraphContext.flush()` now returns a `FlushManifest` describing every write. Existing callers ignoring the return value keep working.
  - `emitSubscriptionOutbox()` runs inside the block-processor transaction: matches each write against active subscriptions, inserts outbox rows (bulk `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, dedup_key)` for idempotent replays). Bypassed when `SECONDLAYER_EMIT_OUTBOX=false`.
  - `startEmitter()` boots alongside `startSubgraphProcessor`. `LISTEN subscriptions:new_outbox` + `LISTEN subscriptions:changed`, `FOR UPDATE SKIP LOCKED LIMIT 50` batch claim, per-sub in-memory concurrency semaphore (default 4), HTTP dispatch via Standard Webhooks format with AbortSignal timeout, `subscription_deliveries` attempt log truncated to 8KB. Circuit breaker trips at 20 consecutive failures → sub `paused`. Backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h. Retention sweep hourly.
  - Dashboard subscription detail page polls the last 100 deliveries every 5s.
  - Emitter requires session-mode PG connection — pgbouncer transaction mode breaks the persistent LISTEN. Document in migration guide.

- Updated dependencies [[`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`8f2d720`](https://github.com/ryanwaits/secondlayer/commit/8f2d72038c28aca7bd91efb4b0c93f72bac469d3)]:
  - @secondlayer/stacks@1.0.0

## 3.0.0-beta.2

### Patch Changes

- Subscription emitter lands — the end-to-end delivery loop.

  - `SubgraphContext.flush()` now returns a `FlushManifest` describing every write. Existing callers ignoring the return value keep working.
  - `emitSubscriptionOutbox()` runs inside the block-processor transaction: matches each write against active subscriptions, inserts outbox rows (bulk `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, dedup_key)` for idempotent replays). Bypassed when `SECONDLAYER_EMIT_OUTBOX=false`.
  - `startEmitter()` boots alongside `startSubgraphProcessor`. `LISTEN subscriptions:new_outbox` + `LISTEN subscriptions:changed`, `FOR UPDATE SKIP LOCKED LIMIT 50` batch claim, per-sub in-memory concurrency semaphore (default 4), HTTP dispatch via Standard Webhooks format with AbortSignal timeout, `subscription_deliveries` attempt log truncated to 8KB. Circuit breaker trips at 20 consecutive failures → sub `paused`. Backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h. Retention sweep hourly.
  - Dashboard subscription detail page polls the last 100 deliveries every 5s.
  - Emitter requires session-mode PG connection — pgbouncer transaction mode breaks the persistent LISTEN. Document in migration guide.

## 3.0.0-beta.1

### Minor Changes

- Subscriptions CRUD surface — new `sl.subscriptions.*` client plus the DB schema + query helpers that back it.

  - SDK: `sl.subscriptions.create/list/get/update/delete/rotateSecret/pause/resume` with `CreateSubscriptionResponse` returning a one-time `signingSecret`.
  - Shared: Migration `0057_subscriptions` creates `subscriptions` + `subscription_outbox` + `subscription_deliveries` with the `subscriptions:new_outbox` notify trigger. Kysely types for all three tables. New `standard-webhooks` signing helper (matches Svix reference vectors). Subscription queries with encrypted signing secrets (reuses `crypto/secrets`).
  - OSS bootstrap: `SECONDLAYER_SECRETS_KEY` autogenerates to `.env.local` on first use when `INSTANCE_MODE=oss`.

  No delivery yet — the emitter worker + outbox draining lands Sprint 3. Platform-mode mirror table deferred to a follow-up.

## 3.0.0-alpha.0

### Major Changes

- Drop workflow + sentry tables, query helpers, and schemas. Migration 0056 demolishes residual tables (`workflow_runs`, `workflow_steps`, `workflow_queue`, `workflow_ai_usage_daily`, `sentries`, `sentry_alerts`, `tx_confirmed_notify`).

### Minor Changes

- [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing foundation (Sprint A) — switch from 14-day trial to activity-based auto-pause, org-level billing prep.

  - Migration 0046 drops `tenants.trial_ends_at` + index, adds `tenants.last_active_at timestamptz NOT NULL DEFAULT now()` with index `(plan, last_active_at) WHERE status = 'active'`
  - Migration 0047 adds nullable `tenant_id` to `usage_daily` (+ best-effort backfill for single-tenant accounts), widens the unique key to `(account_id, tenant_id, date)` so Sprint-C Stripe metering can bill per-tenant
  - `TrialExpiredError` + `TRIAL_EXPIRED` code dropped (dead after trial removal)
  - New `bumpTenantActivity(slug)` + `listIdleHobbyTenants(idleSince)` query helpers
  - CLI drops trial-days-left from `sl instance info` and `sl whoami`, drops `TRIAL_EXPIRED` handlers

- [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing Sprint C.1 — decouple compute from plan for add-ons.

  - Migration 0048 adds `tenant_compute_addons` table. Each row = one add-on bundle (memory/cpu/storage deltas with optional effective window + Stripe subscription_item_id). Effective compute = plan base + SUM(active deltas).
  - New `@secondlayer/shared/db/queries/tenant-compute-addons` module: `listActiveAddonsForTenant`, `computeEffectiveCompute(tenantId, base)`.
  - `@secondlayer/provisioner` breaking changes:
    - `resizeTenant(slug, planId)` → `resizeTenant(slug, { plan, totalCpus, totalMemoryMb, storageLimitMb })`. Plan stays as a label; sizing is explicit.
    - `getTenantStatus(slug, plan)` → `getTenantStatus(slug, plan, storageLimitMb)`. Caller passes the effective storage limit from the tenants row.
    - `rotateTenantKeys` preserves existing container sizing by reading from `docker inspect` instead of recomputing from the plan — so it stays correct for tenants with add-ons.
    - `POST /tenants/:slug/resize` body shape: `{ plan, totalCpus, totalMemoryMb, storageLimitMb }`.
    - `GET /tenants/:slug` now reads `storageLimitMb` query param.
  - New exported `allocForTotals(totalMemoryMb, totalCpus)` from `packages/provisioner/src/plans.ts` — auto-biases to PG-heavy split below 1 GB, default split above.
  - Platform API `POST /api/tenants/me/resize` now composes plan base + active add-ons via `computeEffectiveCompute` before calling the provisioner. `tenants.cpus/memory_mb/storage_limit_mb` cache the effective values for dashboard + billing.
  - Add-on CRUD + Stripe wiring land in Sprint C.2/C.3; this sprint is data-model + plumbing only.

- [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Soft spend caps with 80% threshold alerts — the core anti-surprise-bill differentiator.

  - Migration 0050 adds `account_spend_caps` table (one row per account): monthly + per-line (compute/storage/ai) caps in cents, configurable `alert_threshold_pct` (default 80), `frozen_at`, `alert_sent_at`.
  - New `@secondlayer/shared/db/queries/account-spend-caps` module: `getCaps`, `upsertCaps`, `freezeAccount`, `clearFreeze`, `listFrozenAccountIds`.
  - Worker cron `spend-cap-alert.ts` runs daily: fetches each paid account's upcoming invoice, sends a Resend email at threshold, sets `frozen_at` at 100%. Alert email debounced per billing cycle via `alert_sent_at` comparison to `period_start`.
  - Compute + storage metering crons now read `listFrozenAccountIds` at the top of each tick and skip frozen accounts entirely. Capped accounts keep running but stop accruing billable usage until the next cycle.
  - Stripe `invoice.paid` webhook clears `frozen_at` + `alert_sent_at` on the paying account, unfreezing metering for the new cycle.
  - Session-authed dashboard endpoints `GET /api/billing/caps` + `PATCH /api/billing/caps`. Raising a monthly cap mid-cycle auto-clears an active freeze (user explicitly said "yes, bill more").

- [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Lay Stripe billing foundation on the platform control plane.

  - Migration 0049 adds nullable `accounts.stripe_customer_id` with a partial unique index (ignores NULLs so Hobby users stay out of Stripe entirely — customer records materialize on first upgrade).
  - New `setStripeCustomerId(accountId, id)` query helper + `stripe_customer_id` on the `Account` type.
  - Platform API gains a lazy Stripe SDK singleton (`packages/api/src/lib/stripe.ts`), webhook endpoint (`POST /api/webhooks/stripe`) with raw-body signature verification + audit trail, and session-authed billing routes (`POST /api/billing/upgrade`, `GET /api/billing/portal`) that lazy-create the Stripe customer on first upgrade and return Checkout/Portal URLs.
  - Idempotent setup script (`bun run stripe:setup` in `@secondlayer/api`) upserts one "Secondlayer" product, a Pro monthly price (`$25/mo`, lookup_key `secondlayer_pro_monthly`), and billing meters + metered prices for compute hours, storage GB-months, and AI eval overages. Enterprise remains custom-quoted per deal.
  - Docker `.env.example` documents the new env surface: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_METER_*`, `STRIPE_PRICE_*_OVERAGE`.

### Patch Changes

- [`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop the marketplace-era columns from `subgraphs` (`is_public`, `tags`, `description`, `forked_from_id`) via migration `0045`. The columns were added by `0022_marketplace` and have been unused since the marketplace feature was removed in 2.1.0. Types updated accordingly.

- Updated dependencies []:
  - @secondlayer/stacks@1.0.0-alpha.0

## 2.1.0

### Minor Changes

- [`2024259`](https://github.com/ryanwaits/secondlayer/commit/2024259c0a474dcede50fa8d6fb4018877632435) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Production hardening for dedicated hosting.

  - Per-tenant `pg_dump` backups on an hourly + daily retention ladder; systemd units + Storage Box upload.
  - Agent monitors tenant-pg backup freshness, tenant container health (unhealthy + sustained memory pressure).
  - SSH bastion container gives tenants a direct `DATABASE_URL` via `ssh -L`. New endpoints: `GET /api/tenants/me/db-access`, `POST/DELETE /api/tenants/me/db-access/key`. New CLI: `sl instance db`, `sl instance db add-key <path>`, `sl instance db revoke-key`.
  - `tenant_usage_monthly` table records peak/avg/last storage per month for future billing.
  - `provisioning_audit_log` table captures provision/resize/suspend/resume/rotate/teardown/bastion events.
  - Marketplace removed across the monorepo (SDK, shared schemas + queries, API routes, CLI command, dashboard pages + routes). DB migration for the `0022_marketplace` columns intentionally not reverted — profile columns on accounts are kept for general use; `is_public/tags/description/forked_from_id` stay on `subgraphs` as history and can be dropped in a later migration.

## 2.0.0

### Major Changes

- [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Cutover to dedicated-only. Shared-tenancy subgraph code + infra removed now that every customer runs on per-tenant `sl-{role}-<slug>` containers.

  - **Breaking (shared)**: migration `0041` drops `subgraphs.api_key_id`. Schema-level uniqueness restored to `UNIQUE (name)` (previously scoped via `(api_key_id, name)` partial indexes). Tenant DBs already had `NULL api_key_id` — safe.
  - **Breaking (api)**: `/api/subgraphs` + `/api/node` stop mounting in `INSTANCE_MODE=platform`. Platform API is a pure control plane: accounts, projects, sessions, tenants, auth, marketplace, admin. Subgraph queries must hit the tenant URL (`https://{slug}.{BASE_DOMAIN}/api/subgraphs`).
  - **Breaking (api)**: `assertSubgraphOwnership` now a thin DB read — every remaining caller already proved tenant-membership via JWT/static-key middleware.
  - `pgSchemaName(name, accountPrefix?)` → `pgSchemaName(name)`. Tenant DBs are self-contained — no prefix disambiguation.
  - Admin stats endpoint returns tenant counts (`totalTenants`, `activeTenants`, `suspendedTenants`) in place of the old subgraph counts.
  - Worker `measureStorage` cron skips in platform mode (per-tenant measurement is the provisioner's job).
  - Infra: `subgraph-processor` service + hetzner volume override removed from compose; `deploy.sh` includes `--profile platform` so provisioner picks up compose changes without manual recreate.

### Minor Changes

- [`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b) Thanks [@ryanwaits](https://github.com/ryanwaits)! - CLI DX rework, Sprint 1 (backend foundation):

  - Migration `0042_tenant_project_id` — adds `tenants.project_id uuid REFERENCES projects(id) ON DELETE SET NULL` + index. Supports `1 project : 1 tenant` today, `1 project : N tenants` later.
  - `TenantsTable.project_id` added to types. `insertTenant` accepts optional `projectId`.
  - No migration of existing tenant rows — `project_id = NULL` is legal (legacy tenants provisioned via `POST /api/tenants`). New provisions via `POST /api/projects/:slug/instance` populate it.

- [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86) Thanks [@ryanwaits](https://github.com/ryanwaits)! - CLI v2 — session-based auth, tenant auto-resolve, full instance lifecycle.

  **Breaking changes (`@secondlayer/cli`)**:

  - `sl auth login/logout/status` replaced by top-level `sl login` / `sl logout`. `sl auth` command group removed entirely.
  - `sl auth keys list/create/revoke/rotate` removed. Session tokens are the only CLI credential; machine access uses `SL_SERVICE_KEY`.
  - `sl instance connect <url> --key` removed. Tenant URL + service key are auto-resolved per command from the session.
  - `sl sync` removed (superseded by `sl local`).
  - `~/.secondlayer/config.json` no longer holds `apiUrl` / `apiKey`. Sessions at `~/.secondlayer/session.json`.
  - `SECONDLAYER_API_KEY` env var no longer read.

  **New (`@secondlayer/cli`)**:

  - `sl login` — magic-link email with 6-digit code. Session cached 90d with server-side sliding-window renewal.
  - `sl logout` — revokes session server-side + clears local file.
  - `sl whoami` — shows email, plan, active project, instance URL + trial days.
  - `sl project create <name> | list | use <slug> | current` — project management, per-directory binding at `./.secondlayer/project`.
  - `sl instance create --plan <…> | info | resize | suspend | resume | delete | keys rotate` — full tenant lifecycle.
  - Resolver auto-mints 5-min ephemeral service JWTs per command. No long-lived service key on disk.
  - `SL_SERVICE_KEY` + `SL_API_URL` env-var bypass for CI/OSS. `sl instance *` refuses in OSS mode with a clear error.

  **`@secondlayer/shared`**:

  - New error codes + classes: `KeyRotatedError` (401), `TrialExpiredError` (402), `TenantSuspendedError` (423). `NO_TENANT_FOR_PROJECT` (404) and `INSTANCE_EXISTS` (409) added to `CODE_TO_STATUS`.
  - Tenant API `auth-modes.dedicatedAuth` throws `KeyRotatedError` on gen mismatch so the CLI can retry-once transparently.

- [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Phase 1 instance-page hardening. Adds per-tenant key rotation with independent service/anon generations, suspend/resume endpoints on the provisioner, hard-delete teardown, typed provisioner errors, and automatic attachment of the platform postgres to `sl-source` with a `postgres` alias at provision time.

  - `jwt.ts` — `mintTenantKeys` now takes `{ serviceGen, anonGen }` and embeds a `gen` claim; adds `mintSingleKey` for role-scoped rotation.
  - `lifecycle.ts` — new `rotateTenantKeys(slug, plan, type, newGens)` recreates the tenant API container with new env vars and mints replacement key(s).
  - `routes.ts` — adds `POST /tenants/:slug/keys/rotate`; bubbles typed error codes + appropriate HTTP status via new `httpStatusForProvisionError`.
  - `types.ts` — adds `ProvisionErrorCode`, `classifyProvisionError`, `httpStatusForProvisionError`.
  - `docker.ts` — adds `networkConnectWithAlias` (idempotent); `provision.ts` calls it to attach `secondlayer-postgres-1` to `sl-source` as `postgres` so fresh Hetzner hosts work without manual compose edits.
  - `@secondlayer/shared` — migration `0040_tenant_key_generations` adds `service_gen` + `anon_gen` counters to `tenants`; new queries `bumpTenantKeyGen`, `updateTenantKeys`, `deleteTenant`.
  - `@secondlayer/api` middleware — `dedicatedAuth` validates the `gen` claim against `SERVICE_GEN`/`ANON_GEN` env; adds `/me/keys/rotate`, `/me/suspend`, `/me/resume`; changes `DELETE /me` from soft-suspend to hard-delete (containers + volume + DB row).

### Patch Changes

- [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Fix `getOrCreatePool` TLS-skip heuristic: any dotless hostname (Docker service alias like `postgres`, `sl-pg-<slug>`) is now treated as local and skips TLS. Previously only `@postgres:` was whitelisted, causing tenant-DB connections to `sl-pg-<slug>` to try TLS against a non-TLS alpine postgres → ECONNRESET.

## 1.1.0

### Minor Changes

- [`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 1: AI SDK v6 substrate + sub-step memoization.

  **New step primitives:**

  - `step.generateObject(id, { model, schema, prompt, system? })` — Zod-schemaed structured output via AI SDK v6, any provider
  - `step.generateText(id, { model, prompt, tools?, maxSteps? })` — tool-calling agent loop; tools declared via AI SDK `tool()`

  **Sub-step tool memoization:** tool calls inside `generateText`/`generateObject` persist as child `workflow_steps` rows (new `parent_step_id` column). On parent retry, previously successful tool calls serve from cache instead of re-invoking `execute`.

  **Hash-based memo key:** new `workflow_steps.memo_key` column keys memoization by `sha256(stepId + canonicalJSON(stableInputs))`. Editing a prompt or schema in source invalidates the cache on the next run. **Breaking behavior change** vs v1's `(run_id, step_id)` tuple lookup.

  **`step.ai` deprecated (90-day sunset):** now a shim over `generateObject` that converts the `SchemaField` DSL to Zod. Existing v1 templates continue to work unchanged; migrate at leisure.

  **`tool` re-exported** from `@secondlayer/workflows` — authors write `import { tool } from "@secondlayer/workflows"` + `step.generateText({ tools })`.

  **Bundler:**

  - Raise workflow bundle cap 1 MB → 4 MB (matches subgraph cap)
  - Replace data-URI import with tmpfile import to avoid `NameTooLong` on bundles that include AI SDK dependencies

  **Shared:**

  - New `@secondlayer/shared/pricing` — provider × model USD/M-token constants for dashboard observability

  **Migration required:** `0033_workflow_steps_memo_key` — adds `memo_key` + `parent_step_id` columns to `workflow_steps`, swaps legacy `(run_id, step_id)` UNIQUE index for partial `(run_id, memo_key)` UNIQUE. Runner requires this migration before restart.

- [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 4: chain writes via customer-owned Remote Signer.

  Workflows can now broadcast Stacks transactions without Secondlayer holding any private key. The runner POSTs unsigned tx + context to a customer-hosted HTTPS endpoint, the customer signs, the runner submits.

  **`@secondlayer/workflows`:**

  - New `signers: Record<string, SignerConfig>` field on `WorkflowDefinition`
  - New `signer.remote({ endpoint, publicKey, hmacRef, timeoutMs? })` factory — `hmacRef` names a secret stored separately (see `sl secrets`) so rotation doesn't require redeploy

  **`@secondlayer/stacks`:**

  - New `broadcast(intent, { signer, maxMicroStx?, maxFee?, awaitConfirmation? })` — submits a `TxIntent` via the workflow-declared signer. Returns `{ txId, confirmed }` (confirmation polling lands Sprint 5)
  - New `broadcastContext` AsyncLocalStorage — runner scopes the `BroadcastRuntime` per run; concurrent runs don't share state
  - New error taxonomy: `TxRejectedError` (reason union + `isRetryable`), `TxTimeoutError`, `TxSignerRefusedError`

  **`@secondlayer/shared`:**

  - New `@secondlayer/shared/crypto/secrets` — AES-256-GCM envelope (`encryptSecret` / `decryptSecret` / `generateSecretsKey`). Key from `SECONDLAYER_SECRETS_KEY` env
  - New `workflow_signer_secrets` table via migration `0034`

  **`@secondlayer/bundler`:**

  - Deploy-time lint: flags `broadcast()` calls lexically inside a `tool({...})` body that lack `maxMicroStx` + `maxFee` OR `postConditions`. Escape hatch: `// @sl-unsafe-broadcast` comment on the broadcast line. Protects against AI-drainable toolsets.

  **`@secondlayer/cli`:**

  - New `sl secrets list|set|rotate|delete` commands. `set` and `rotate` prompt for the value via masked input if not supplied on the command line

  **New package `@secondlayer/signer-node`:**

  - Customer-hosted reference signer service. `createSignerService({ privateKeyHex, hmacSecret, policy })` returns a Hono app; mount on any Fetch-compatible runtime (Bun, Deno, Cloudflare Workers, Node via `@hono/node-server`)
  - Policy helpers: `allowlistFunctions`, `dailyCapMicroStx`, `requireApproval`, `composePolicies`, `denyAll`
  - Railway example under `packages/signer-node/examples/railway/`

  **API:**

  - New `/api/secrets` routes — list / upsert / delete per-account. Values AES-encrypted at rest; never returned to clients.

  **Migrations required:** `0034_workflow_signer_secrets` before runner restart.

  **Runtime env added:** `SECONDLAYER_SECRETS_KEY` (32-byte hex, generate with `openssl rand -hex 32`). API + runner both need it to en/decrypt. Without it, `sl secrets set` and broadcast both error at call-site.

  **Sprint 4 scope limits (expand later):**

  - `broadcast` supports `TransferIntent` + `ContractCallIntent` only; `DeployIntent` + `MultiSendIntent` throw "not yet implemented"
  - `awaitConfirmation: true` is a no-op in Sprint 4; Sprint 5 wires subgraph pg_notify confirmation polling
  - Default fee: 10k µSTX when `maxFee` isn't supplied. No fee estimation yet — Sprint 5 will add estimateFee-driven defaults.

- [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 5: budgets, awaitConfirmation, error-aware retries.

  **`@secondlayer/workflows`:**

  - New `WorkflowDefinition.budget: BudgetConfig` field with caps across three dimensions:
    - `ai`: `maxUsd`, `maxTokens`
    - `chain`: `maxMicroStx`, `maxTxCount`
    - `run`: `maxDurationMs`, `maxSteps`
  - `reset`: `"daily" | "weekly" | "per-run"` — period boundary
  - `onExceed`: `"pause" | "alert" | "silent"` — pause the workflow (default), fire a `onExceedTarget` delivery, or tick counters silently
  - Zod validation on deploy

  **`@secondlayer/shared`:**

  - New migration `0035_workflow_budgets` — `workflow_budgets` table with one row per `(workflow_definition_id, period)`. Tracks `ai_usd_used`, `ai_tokens_used`, `chain_microstx_used`, `chain_tx_count`, `run_count`, `step_count`, `reset_at`
  - New migration `0036_tx_confirmed_notify` — pg_notify trigger on core `transactions` table publishing tx_id on `tx:confirmed` channel

  **`@secondlayer/workflow-runner`:**

  - `budget/enforcer.ts` — per-run `BudgetEnforcer` called from `memoize()`. `assertBeforeStep()` refuses if any counter is exhausted; `recordAi` / `recordBroadcast` / `recordStep` increment after each step. Emits `BudgetExceededError` (non-retryable) on `pause` behavior
  - `budget/reset-cron.ts` — runs every minute. Auto-resumes `status = "paused:budget"` workflows once their period rolls over; prunes budget rows older than 30 days (excluding `per-run` rows)
  - `confirmation/subgraph.ts` — pg_notify listener on `tx:confirmed`. `awaitTxConfirmed(txId, timeoutMs)` returns when the indexer inserts a matching row; times out with `TxTimeoutError` (retryable with fee bump). **No Hiro fallback** — Secondlayer's native indexer is the source of truth.
  - `broadcast` runtime now honors `awaitConfirmation: true` — blocks until confirmed or times out. Default timeout: 120 seconds.
  - `queue.ts` retry policy consults the thrown error's `isRetryable` property. `TxRejectedError[abort_by_post_condition]`, `TxSignerRefusedError`, `BudgetExceededError` all mark as non-retryable and skip the exponential backoff loop, failing the run immediately with the classification reason appended to the error message.

  **Breaking change:** runners must apply migrations `0035` + `0036` before restart. Workflows deployed before Sprint 5 continue to work without budgets (the `budget` field is optional).

  **Deferred:**

  - Dashboard burn-down UI for budgets (follows up with a Sprint 5.5 patch; the underlying counters are already being tracked)
  - Fee estimation (`maxFee` default stays 10k µSTX — Sprint 6 will drive defaults off `estimateFee`)

### Patch Changes

- Updated dependencies [[`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
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

- [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Server-side subgraph bundler + source capture, mirroring the workflows authoring loop.

  - **API**: new `POST /api/subgraphs/bundle` runs `bundleSubgraphCode` from `@secondlayer/bundler` and returns `{ name, version, sources, schema, handlerCode, sourceCode, bundleSize }`. `BundleSizeError → 413`, other failures → 400 with `code: "BUNDLE_FAILED"`. New `GET /api/subgraphs/:name/source` returns the original TypeScript source for deployed subgraphs, or a `readOnly` payload for rows predating the migration. `POST /api/subgraphs` now threads `sourceCode` through `deploySchema` so the original source is persisted on deploy.
  - **SDK**: new `subgraphs.bundle({ code })` and `subgraphs.getSource(name)` methods + `BundleSubgraphResponse` / `SubgraphSource` types.
  - **shared**: migration `0031_subgraph_source_code` adds `source_code TEXT NULL` to the `subgraphs` table; `registerSubgraph` upsert + `DeploySubgraphRequest` schema both accept an optional `sourceCode` field (max 1MB).
  - **subgraphs**: `deploySchema()` accepts `sourceCode` in its options and forwards it to `registerSubgraph`.

  Unlocks the next wave of the chat authoring loop (read/edit/deploy/tail subgraphs in a session).

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.

  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.

- [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - `POST /api/workflows` now maps `VersionConflictError` to HTTP 409 `{ error, code, currentVersion, expectedVersion }`, reads `x-sl-origin: cli|mcp|session` for telemetry, and logs every deploy. The response body now includes the resolved `version`.

  - Added `dryRun: true` mode on `POST /api/workflows` — validates the bundle via data-URI import, skips disk and DB writes, and returns `{ valid, validation, bundleSize }`.
  - Added `GET /api/workflows/:name/source` — returns `{ name, version, sourceCode, readOnly, updatedAt }`, with a `readOnly: true` degradation for workflows deployed before source capture.
  - SDK: `Workflows.deploy()` accepts `expectedVersion` and `dryRun` and throws a typed `VersionConflictError` on 409. `Workflows.getSource(name)` fetches the stored source. Every SDK request sends `x-sl-origin` (default `cli`, overridable via `new SecondLayer({ origin })`). `ApiError` now preserves the parsed response body.
  - MCP: new `workflows_deploy` tool (bundles via `@secondlayer/bundler`, sets `x-sl-origin: mcp`, surfaces bundler errors verbatim, supports `expectedVersion` + `dryRun`), `workflows_get_definition` (returns stored TypeScript source), and `workflows_delete`.

- [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Ship-ready workflow polish: versioning, rollback, bulk ops, and idempotent deploys.

  - **Versioned handler bundles.** `POST /api/workflows` now writes `data/workflows/{name}-{version}.js` (exported `bumpPatch` from `@secondlayer/shared`). The runner already reads `handler_path` from the row so in-flight runs finish on their original bundle while new runs pick up the latest. The route opportunistically prunes on-disk bundles to the most recent 3 versions after every deploy.
  - **Rollback.** New `POST /api/workflows/:name/rollback` route picks a prior on-disk bundle (or the specified `toVersion`), re-publishes it as a new patch version for audit, and refreshes `handler_path`. SDK `workflows.rollback()`, MCP `workflows_rollback`, and a web `rollback_workflow` HIL session tool (re-using the existing action card) are all wired up.
  - **Bulk pause + cancel run.** `POST /api/workflows/pause-all` pauses every active workflow in the account (and disables their `workflow_schedules` rows). `POST /api/workflows/runs/:runId/cancel` marks a running / pending run as cancelled and removes any queue entry. Exposed via `workflows.pauseAll()` / `workflows.cancelRun()` and new `workflows_pause_all` / `workflows_cancel_run` MCP tools.
  - **Idempotent deploy.** `DeployWorkflowRequestSchema` gained a `clientRequestId` field. The API keeps a 30-second in-memory cache keyed by `(apiKeyId, clientRequestId)` and replays the previous response on a repeat POST. The chat deploy card sends `deploy-${toolCallId}`, and the edit card sends `edit-${expectedVersion}-${name}` so double-clicks and accidental re-confirms don't double-deploy.
  - **Workflow detail → chat.** The `/workflows/[name]` page now has an **Open in chat** CTA that navigates to a fresh session pre-seeded with `Read the workflow "{name}" and show me its source so I can edit it.`

## 0.12.3

### Patch Changes

- Add waitlist query functions (listWaitlist, getWaitlistById, approveWaitlistEntry) and admin constants export

## 0.12.2

### Patch Changes

- fix schema diff false positives from JSONB key reordering; hot-reload handler code after redeploy; handle bigint in jsonb serialization

## 0.12.1

### Patch Changes

- fix(subgraphs): complete accountId migration across deployer, marketplace, ownership

  Removes remaining apiKeyId fallbacks introduced in the Sprint 1 account-scoping change:

  - deployer.ts: getSubgraph lookup no longer falls back to apiKeyId
  - marketplace.ts: fork collision check and schema prefix use accountId
  - ownership.ts: assertSubgraphOwnership checks account_id instead of api_key_id
  - deleteSubgraph: uses accountId parameter consistently

## 0.12.0

### Minor Changes

- feat(subgraphs): smart deploy — auto-versioning, auto-reindex, schema diff

  - System now owns versioning: patch auto-increments on every deploy (1.0.0 → 1.0.1); use --version flag for intentional bumps
  - Breaking schema changes auto-trigger reindex — no --reindex flag needed
  - Deploy output shows schema diff (added tables/columns, breaking changes, new version)
  - version field removed from schema hash so version bumps don't look like schema changes
  - --force flag skips reindex confirmation prompt
  - Handler code persisted in DB so container restarts don't break in-flight reindexes (migration 0029)

## 0.11.0

### Minor Changes

- feat(subgraphs): account-wide subgraph scoping

  Subgraphs are now scoped at the account level rather than per API key. Any API key on the same account can deploy and update the same named subgraph without creating duplicates. Includes migration 0028 which adds `account_id` to the subgraphs table and renames existing PG schemas to use account prefix instead of key prefix.

  **Breaking for self-hosted:** Run migration 0028 before deploying. Stop the subgraph processor before running the migration (it renames live PG schemas).

## 0.10.1

### Patch Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

## 0.10.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

## 0.9.0

### Minor Changes

- Add 6-digit login code alongside magic link for dual auth (code entry + link click).

## 0.8.1

### Patch Changes

- e274333: fix(subgraphs): use highest_seen_block ceiling and add startBlock support

## 0.8.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

## 0.7.1

### Patch Changes

- Batch block fetching with adaptive sizing and prefetch pipeline for 15-18x faster subgraph catch-up. Batch INSERT statements on flush. Non-destructive backfill support. Increase default DB connection pool to 20.

## 0.7.0

### Minor Changes

- Cache Hiro event archive locally for up to 24h to avoid redundant ~25GB downloads during auto-backfill.

## 0.6.1

### Patch Changes

- Add ArchiveReplayClient for backfilling from Hiro event observer archive, removing public API dependency

## 0.6.0

### Minor Changes

- Add HiroPgClient for direct-PG bulk backfill, increase default fetch timeout to 120s.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.2

## 0.5.1

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

## 0.5.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

## 0.4.0

### Minor Changes

- Add contract query helpers with full-text search via pg_trgm. Add `getContractAbi()` for Stacks node RPC. Add `ForbiddenError` class. Treat Hiro 429 responses as reachable and increase health check timeout. Drop contracts table in favor of views system.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.0

## 0.3.0

### Minor Changes

- 48e42ba: Add local replay client for self-serve block reconstruction from Postgres. Add tx_index migration and type. Export local-client from package.

### Patch Changes

- Updated dependencies [a070de2]
  - @secondlayer/stacks@0.1.0

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2

## 0.2.0

### Minor Changes

- Add @secondlayer/shared package with DB layer, job queue, schemas, HMAC signing, and Stacks node clients

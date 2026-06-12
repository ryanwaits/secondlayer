# @secondlayer/api

## 1.22.3

### Patch Changes

- 1857f19: fix: x402 spot feed retry storm — gate refresh cadence by `nextAttemptAt` so a failed CoinGecko fetch backs off (30s, or the 429 `Retry-After`) instead of re-firing on every request; debounced failure logging; warm the cache at boot; coarser 5m success cadence. STX/sBTC now price off the live feed instead of being pinned to the env fallback. Also make the settle/drawdown `recordSpend` funnel injectable so the x402 middleware tests run without a Postgres connection (fixes 4 DB-dependent test failures).

## 1.22.2

### Patch Changes

- Updated dependencies [e27d752]
  - @secondlayer/shared@6.33.0
  - @secondlayer/subgraphs@3.14.2
  - @secondlayer/platform@0.1.3

## 1.22.1

### Patch Changes

- Updated dependencies [ab8360d]
- Updated dependencies [05b1b12]
  - @secondlayer/subgraphs@3.14.0
  - @secondlayer/shared@6.32.0
  - @secondlayer/sdk@6.22.0
  - @secondlayer/platform@0.1.2

## 1.22.0

### Minor Changes

- aef3e54: Hosted LLM surfaces removed (Sessions + command-palette agent). Bring your own agent harness via MCP/skills/prompts instead. `chat_sessions`/`chat_messages` tables dropped (migration 0097); `POST /me/meter` endpoint and the `ai_evals` Stripe meter removed.

### Patch Changes

- 5333c43: Remove L1/L2/L3 layer terminology from user-facing descriptions and READMEs (Stacks is itself a Bitcoin L2 — the terms were confusing); describe surfaces as raw (Streams), decoded (Index), and your schema (Subgraphs). Also drop the stale "Foundation Dataset" template wording and refresh the api README Index endpoint list.
- 0a1ff0f: Billing resolve now recognizes trialing subscriptions — the post-checkout fast-resolve filtered on status "active", silently no-opping for every 30-day-trial signup and leaving the plan flip to the webhook race.
- Updated dependencies [5333c43]
- Updated dependencies [db40071]
- Updated dependencies [8ac70d7]
- Updated dependencies [aef3e54]
- Updated dependencies [9ee7879]
  - @secondlayer/sdk@6.21.2
  - @secondlayer/shared@6.31.0
  - @secondlayer/subgraphs@3.12.0
  - @secondlayer/platform@0.1.1

## 1.21.0

### Minor Changes

- 2132e2e: Pro plan enforced end-to-end: tier ladder free 100 / Pro 250 / Scale 500 req/s on Index and Streams; free keyed Index reads unblocked (a minted key is never slower than anonymous); private subgraphs and webhook-subscription quotas (3/25/unlimited) gate on plan with existing private rows grandfathered; plans sell rate-tier limits — per-tenant container vocabulary, dead compute/storage metering crons, and tenant-plan-sync removed; usage surfaces read tier limits from the enforcing configs; x402 marked experimental beta in the OpenAPI x-x402 block.

### Patch Changes

- Updated dependencies [2132e2e]
- Updated dependencies [2132e2e]
- Updated dependencies [7a9a0d2]
  - @secondlayer/sdk@6.21.1
  - @secondlayer/stacks@2.5.1
  - @secondlayer/platform@0.1.0

## 1.20.1

### Patch Changes

- Updated dependencies [6fcd653]
- Updated dependencies [6fcd653]
- Updated dependencies [0449af7]
- Updated dependencies [408e8b7]
- Updated dependencies [70004c0]
- Updated dependencies [5dc8fb3]
- Updated dependencies [3def7d4]
- Updated dependencies [38dad1c]
- Updated dependencies [38dad1c]
  - @secondlayer/sdk@6.21.0
  - @secondlayer/shared@6.30.0
  - @secondlayer/subgraphs@3.11.0
  - @secondlayer/platform@0.0.28

## 1.20.0

### Minor Changes

- fb7acf4: x402 facilitator (Sprint 2): price catalog with a dynamic gas-aware floor (`x402/catalog.ts`), static payment verification + confirmed-tier settlement that block-polls until the transfer is canonical (`x402/facilitator.ts`), a fail-closed Redis nonce/replay store (`x402/nonce-store.ts`), and a by-txid canonical transfer reader (`index/transfer-by-txid.ts`).
- 8253e67: x402 middleware + ledger (Sprint 3): `x402PaymentRequired({surface})` runs the full x402 v2 handshake — account-backed callers bypass, accountless callers get a base64 `PAYMENT-REQUIRED` challenge, and a signed retry is verified (incl. nonce-in-memo binding), settled confirmed-tier, recorded to the `x402_payments` ledger, and acknowledged with a `PAYMENT-RESPONSE` receipt. Nonce replay and broadcast-but-unconfirmed both return 402.
- 6c6d2c9: x402 optimistic finality tier (Sprint B): Index/Streams now serve **near-instant** on broadcast-accept (the node admitting the sponsored tx to its mempool), reconciling asynchronously, instead of blocking ~5–29s for canonical confirmation. Gated per-principal by an optimistic gate (`x402/optimistic-gate.ts`) — a fixed-window velocity cap plus a reputation strike counter — that **fails closed** to confirmed-tier; high-value surfaces can stay `confirmed`. `settlePayment` gains a broadcast-no-await mode (`state: "optimistic"`), the catalog carries per-surface `finality` (Index/Streams default optimistic), and the worker reconciler now advances `pending → confirmed | reverted` and records a strike (shared Redis key, `x402StrikeKey`) on revert so repeat droppers lose optimism. Reconciliation confirms against our own indexed `decoded_events` (canonical-gated) — the same substrate the confirmed-tier serve verifies against — so it's self-contained / RPC-free. The SDK's `X402Receipt` now carries the settlement `state` (`optimistic` | `confirmed`).
- 2e52a78: Wire the x402 rail onto live surfaces (Sprint 4), gated on `X402_SPONSOR_KEY` so it's a no-op until the sponsor wallet is funded. When live: Streams becomes keyless-but-paid (accountless callers pay per call via x402; keyed callers bypass — `streamsBearerAuth` anon fall-through + anon-tolerant rate-limit/retention) and Index's anon path is x402-gated. Adds `GET /x402/supported` (self-hosted capability + price catalog, no external Bazaar), `HiroClient.getTransaction`, and a worker cron (`x402-reconcile`, 5-min sweep over the last hour) that flips post-serve-reverted ledger rows.

### Patch Changes

- f9d7866: x402 pricing now uses a live, cached USD spot feed for the non-stable assets (sBTC→BTC/USD, STX→STX/USD) instead of a static env value. `spotUsd` is stale-while-revalidate and never blocks a request: it serves an in-process cache (refreshed ~60s in the background, last-known held up to 10m if the feed is down). Fallback chain: live cache → `X402_SPOT_<SYM>_USD` env override → omit the asset — so if a price is unavailable the challenge degrades to USDCx-only (the dollar peg, always exact) rather than mispricing. Feed URL overridable via `X402_SPOT_URL` (CoinGecko shape).
- ab2855e: Make the Streams/Index routers mount x402 via an injected, pre-built middleware (`opts.x402Middleware`) instead of reading env + building the facilitator inside the route. The enable/which-facilitator decision now lives at the app composition root (the default export), keeping the route factories pure and env-free; tests inject a fake-backed middleware. Adds a route-integration test driving an accountless request through the real Index router end to end: no-key → 402 challenge → real signed sponsored payment → real `verifyPayment` → settle → real handler returns data, plus ledger write and replay rejection.
- 389976a: Fix x402 native-STX payments: a `TokenTransfer` payload cannot carry post-conditions (Stacks consensus rejects it with "TokenTransfer transactions do not support post-conditions"), so `buildExactTransfer` no longer attaches one for STX — exactness is already inherent in the signed amount+recipient. `verifyPayment` now derives the payer from the origin spending condition (works for STX, which has no post-condition to read it from) and only requires the Deny-mode FT post-condition for SIP-010. Proven by a devnet end-to-end: the sponsored STX transfer mined with the payer paying 0 gas and the sponsor paying the fee.
- Updated dependencies [051bbc5]
- Updated dependencies [0640e37]
- Updated dependencies [f242b9c]
- Updated dependencies [49ce0e9]
- Updated dependencies [cf8c86d]
- Updated dependencies [8253e67]
- Updated dependencies [54611cd]
- Updated dependencies [6c6d2c9]
- Updated dependencies [2e52a78]
- Updated dependencies [fb7acf4]
- Updated dependencies [8f2de58]
- Updated dependencies [389976a]
- Updated dependencies [2e52a78]
  - @secondlayer/shared@6.29.0
  - @secondlayer/sdk@6.20.0
  - @secondlayer/stacks@2.5.0
  - @secondlayer/platform@0.0.27

## 1.19.12

### Patch Changes

- Updated dependencies [a063b26]
- Updated dependencies [c2e4caa]
  - @secondlayer/indexer@1.12.5
  - @secondlayer/shared@6.28.1
  - @secondlayer/platform@0.0.26

## 1.19.11

### Patch Changes

- 93cf539: Add a prod-safe single-contract ABI source. New `GET /v1/contracts/:contractId` (registry lookup by id, `?include=abi` for the blob, 404 when absent), SDK `contracts.get(contractId, { includeAbi })`, and a `get_contract_abi` MCP tool. The MCP `scaffold_from_contract` tool now sources ABIs from this registry instead of the OSS/dedicated-only `/api/node/...` proxy (which 404s in prod), so it works in platform/prod.
- 161d558: Add `index.transactions.getProof(txId)` (SDK) and the `index_transaction_proof` MCP tool — fetch a transaction's inclusion proof (raw tx + signed Nakamoto header + merkle path) to verify trustlessly with `verifyTransactionProof`. 404 → null. The proof endpoint now degrades gracefully when the signed-header source (stacks-node) is unreachable: a typed `ProofNodeUnavailableError` → HTTP 503 `PROOF_NODE_UNAVAILABLE` instead of an opaque 500. The api container reads `STACKS_NODE_RPC_URL` (added as a compose env hook, empty by default) — set it to a reachable Nakamoto node to enable proofs in platform/prod.
- Updated dependencies [93cf539]
- Updated dependencies [161d558]
  - @secondlayer/sdk@6.19.0

## 1.19.10

### Patch Changes

- 1318497: Fix `GET /v1/contracts` 500 in prod: the route read from the control/target DB via `getDb()`, but `contracts` is a source-plane table (`TABLE_TO_DB.contracts === "source"`), so with the DB split live the target had no `contracts` table. Read from `getSourceDb()` like every other source-plane reader. This also restores the `contracts_find` agent path.
- Updated dependencies [e9c270c]
- Updated dependencies [9436b6d]
- Updated dependencies [4037871]
  - @secondlayer/sdk@6.18.0
  - @secondlayer/shared@6.28.0
  - @secondlayer/platform@0.0.25

## 1.19.9

### Patch Changes

- 3258962: Enrich the `GET /v1/datasets` catalog: each family now carries `freshness` (status/latest_finalized_cursor/generated_at/to_block/lag_blocks from its bulk-export manifest) and `manifest_url` (the Parquet manifest for DuckDB analytics), or null when no bulk export exists. The BNS name-events manifest is aliased onto the `bns-events` family. The discovery endpoint stays 200 when the chain tip is unavailable (lag is reported as null rather than 503). Makes `datasets_list`'s "how current each is" claim truthful.
- Updated dependencies [cc16ebc]
- Updated dependencies [31ad555]
  - @secondlayer/sdk@6.17.0

## 1.19.8

### Patch Changes

- bbd40f7: Return 422 with a migration plan when refusing a BYO breaking schema change.
- Updated dependencies [1c99bd0]
- Updated dependencies [bbd40f7]
- Updated dependencies [e98f20d]
- Updated dependencies [201b630]
  - @secondlayer/sdk@6.16.0
  - @secondlayer/shared@6.27.0
  - @secondlayer/subgraphs@3.10.0
  - @secondlayer/indexer@1.12.4
  - @secondlayer/platform@0.0.24

## 1.19.7

### Patch Changes

- 8d05ff3: Add `GET /api/subgraphs/:subgraphName/:tableName/aggregate` — scalar aggregates (`_count`/`_countDistinct`/`_sum`/`_min`/`_max`) over the same filter surface as the list/count endpoints. SUM/MIN/MAX round-trip losslessly as strings (NUMERIC `::text`), count/countDistinct as JSON numbers. Numeric-only + allowlist + ≤32-column cap enforced with 400s; parameterized, `ident()`-quoted, schema-qualified SQL.
- Updated dependencies [e5684a5]
- Updated dependencies [62e4d90]
- Updated dependencies [f773a6e]
  - @secondlayer/sdk@6.15.0
  - @secondlayer/shared@6.26.0
  - @secondlayer/subgraphs@3.9.0
  - @secondlayer/platform@0.0.23

## 1.19.6

### Patch Changes

- 78881b3: Add `POST /api/subscriptions/:id/test` — sends a one-off test webhook to the subscription's URL (built for its configured format, SSRF-guarded) and logs it as a delivery row, so it appears under the subscription's deliveries.
- bbff1b7: Make the Index `/v1/index/mempool` cursor opaque — a base64url envelope over the insertion sequence — instead of a bare integer, so it can't be mistaken for the `<block_height>:<event_index>` block-position cursors the confirmed endpoints use. The legacy plain-integer cursor is still accepted (in-flight pagers keep working); discovery now documents the per-endpoint cursor shape.
- 83fd1cd: Add a `trait=` filter to Index reads — `GET /v1/index/events` (contract-keyed event types: ft/nft transfers, mints, burns, print) and `GET /v1/index/contract-calls` now accept `trait=<standard>` (e.g. `sip-010`), resolving via the contract registry as-of the window end and restricting results to conforming contracts. Mutually exclusive with `contract_id`. Brings trait-scoped reads (already in Subgraphs + `/v1/contracts`) to the Index layer; discovery advertises it per event type.
- d97cfac: Drop the legacy `from_block` alias from Streams retention checks. It was half-honored (retention read it, but `/v1/streams/events` rejects it as an unknown param), producing a confusing 403-vs-400 split depending on the requested height. Seek positions now come only from `from_height`/`cursor`.
- 14657ae: Enrich the Streams retention 403 with a structured `details` body — `reason: "RETENTION"`, `oldest_seekable_height`, `oldest_cursor`, `dumps_manifest_url`, and a hint — so a caller hitting the live retention floor is pointed at the cold dumps lane instead of dead-ending. The global error handler now merges `error.details` into the response.
- 7ca9bf8: Advertise the seekable retention floor on Streams `/tip` and `/usage`: `oldest_seekable_height` + `oldest_cursor` (the oldest height/cursor the live API serves for the caller's tier; `null` = unlimited). Consumers can now tell how far back the live lane goes before falling to the cold dumps lane. The SDK `StreamsTip` type carries the new optional fields.
- 9f9d600: Make subgraph SSE `?since=<block>` replay seek instead of scan: the keyset cursor is now seeded from `MIN(_id) WHERE _block_height >= since` (falling back to the live tip when nothing matches yet) rather than starting at `_id=0` and re-scanning the whole table on every poll. The in-loop `_block_height >= since` filter stays as a reorg-safety guard.
- Updated dependencies [3a7f8a2]
- Updated dependencies [14657ae]
- Updated dependencies [2626eb5]
- Updated dependencies [3a57c08]
- Updated dependencies [af82681]
- Updated dependencies [7ca9bf8]
- Updated dependencies [cb2f803]
- Updated dependencies [321e69c]
- Updated dependencies [abb689c]
- Updated dependencies [4b88e5c]
- Updated dependencies [1b41df2]
- Updated dependencies [6e6026d]
  - @secondlayer/shared@6.25.0
  - @secondlayer/sdk@6.14.0
  - @secondlayer/subgraphs@3.8.0
  - @secondlayer/platform@0.0.22

## 1.19.5

### Patch Changes

- Updated dependencies [c171351]
  - @secondlayer/shared@6.24.0
  - @secondlayer/sdk@6.13.0
  - @secondlayer/platform@0.0.21

## 1.19.4

### Patch Changes

- 0424f52: Add `reorgs[]` to the Index `/v1/index/stacking` response so a client tracking stacking actions gets the same height-granular reorg reconciliation signal as `/contract-calls` and `/transactions`. `getStackingResponse` now reads `readChainReorgsForHeightRange` over the returned block-height range (over-inclusive, never under-reports; skipped on an empty page), and the SDK `StackingEnvelope` carries the matching `reorgs` field.
- 2dce84d: Add a real-time Streams push surface: `GET /v1/streams/events/stream` (`text/event-stream`). It's a server-side poll-loop over the same forward event cursor wrapped in SSE — new canonical events are pushed at poll cadence instead of the SDK's long-poll with empty backoff, keeping the immutable/cacheable read model intact. Without a start cursor it live-tails from the current reorg-clamped tip; pass `from_cursor` to resume precisely. Each event frame is independently ed25519-signed inline as `{ event, sig, key_id }` (SSE has no per-frame headers) using the same Streams signing key as the JSON lane, with a 20s `ping` heartbeat to keep idle connections alive.
- Updated dependencies [5b7fccf]
- Updated dependencies [fd8503b]
- Updated dependencies [958c883]
- Updated dependencies [b044f39]
- Updated dependencies [015e39d]
- Updated dependencies [434c947]
- Updated dependencies [eccd246]
- Updated dependencies [0424f52]
- Updated dependencies [189e379]
- Updated dependencies [250e910]
- Updated dependencies [f1706c0]
- Updated dependencies [61ef1d4]
  - @secondlayer/subgraphs@3.7.3
  - @secondlayer/sdk@6.10.0
  - @secondlayer/shared@6.23.0
  - @secondlayer/platform@0.0.20

## 1.19.3

### Patch Changes

- Updated dependencies [ebbb6b0]
- Updated dependencies [9f4619d]
  - @secondlayer/shared@6.22.0
  - @secondlayer/platform@0.0.19

## 1.19.2

### Patch Changes

- Updated dependencies [b1366b3]
  - @secondlayer/shared@6.21.0
  - @secondlayer/subgraphs@3.7.2
  - @secondlayer/platform@0.0.18

## 1.19.1

### Patch Changes

- 8c7c24c: Surface the chain/control DB split state so its dormancy in prod is visible, not silent: add `getDbSplitStatus()` (source/target host+db, no credentials) exposed on the API `/status` and `/public/status` responses; extend `assertDbSplit()` to warn on a dormant single-failure-domain in prod and error when a split var is unset with no `DATABASE_URL` fallback (the silent wrong-DB case); wire `assertDbSplit()` into the worker and subgraph-processor entrypoints
- Updated dependencies [8c7c24c]
- Updated dependencies [a199aeb]
- Updated dependencies [b10a67b]
  - @secondlayer/shared@6.20.0
  - @secondlayer/subgraphs@3.7.1
  - @secondlayer/platform@0.0.17

## 1.19.0

### Minor Changes

- e9d4594: Re-source the PoX-4 stacking decoder over the public Index HTTP API (removing its source-DB coupling), serve burn_block_height on /v1/index/transactions, and enable the stacking decoder by default (set POX4_DECODER_ENABLED=false to opt out; POX4_BACKFILL_FROM_HEIGHT bounds the backfill scan)
- 9c5125b: Populate `reorgs[]` on /v1/index/transactions and /v1/index/contract-calls (previously always empty despite being advertised). Reconciled at block-height granularity since the tx cursor isn't event-indexed — over-inclusive, never under-reports — so confirmed-tx consumers get the same at-least-once reorg signal the event endpoints provide

### Patch Changes

- a1f18e6: Back the API rate limiters with a shared Redis store (fail-open) so limits stay correct across multiple API instances; falls back to process-local limits when REDIS_URL is unset
- Updated dependencies [173340a]
- Updated dependencies [e9d4594]
- Updated dependencies [0865ca2]
- Updated dependencies [cc75ef3]
- Updated dependencies [6b11c2a]
  - @secondlayer/shared@6.19.0
  - @secondlayer/indexer@1.12.3
  - @secondlayer/platform@0.0.16

## 1.18.1

### Patch Changes

- a16a892: fix(streams): clamp servable tip by a fixed block margin instead of subtracting lag_seconds from block height (unit mismatch held the tip ~80s behind chain post-Nakamoto)

## 1.18.0

### Minor Changes

- e0f9499: Agent-reachable, hardened API-key mint. A headless agent holding an account-level (owner) key can now self-provision a SCOPED `streams`/`index` read key via `POST /v1/api-keys` — no dashboard. The minted key is always scoped (never an account/superkey), inherits the account plan's tier, is per-IP rate limited, and is bounded by a per-account active-key ceiling. Surfaced as `sl.apiKeys.create()` (SDK), `sl keys create` (CLI), and the `account_create_key` MCP tool.

  Also closes a privilege-escalation hole on the existing `POST /api/keys`: it accepted any valid credential and did no product check, so a leaked scoped key could mint an account superkey. Minting is now owner-gated (a dashboard session or an `account`-product key), and non-session callers are confined to scoped keys with an inherited tier.

- a9be0a3: Let an agent read its own consumption and limits. `GET /v1/streams/usage` and `GET /v1/index/usage` return the account's events today + this month for that product plus its tier limits (Streams: rate limit + retention days; Index: rate limit), reusing the existing metering. Streams is key-mandatory; Index requires a Build+ key (anonymous → 401). Surfaced as `sl.streams.usage()` / `sl.index.usage()` (SDK) and the `streams_usage` / `index_usage` MCP tools, and listed in the `/v1/streams` and `/v1/index` discovery routes.
- 109d697: Make the Index and Streams event vocabularies runtime-discoverable. `GET /v1/index` now exposes a machine-readable `event_type_filters` map — per event type its `columns`, `allowed_filters`, `equality_filters`, and `required_non_null` (generated from the event registry, so it can't drift from what the endpoint accepts) — instead of a single flattened filter list with a prose caveat. `GET /v1/streams` now lists `event_types` and a structured `filters` spec (name + type) for its events route. A test pins the Index registry to the shared decoded event-type list so discovery can't lie.
- 22725d0: Expose subgraph operation status so agents can poll a reindex/backfill to completion instead of guessing. `reindex`/`backfill`/`stop` already return an `operationId`; now `GET /api/subgraphs/:name/operations/:id` returns that operation's live status (kind, status, processed blocks, a derived 0–1 progress, error, timestamps), and `GET /api/subgraphs/:name/operations` lists recent operations. Surfaced as `sl.subgraphs.getOperation(name, id)` / `sl.subgraphs.operations(name)` (SDK) and the `subgraphs_operation` MCP tool. Backed by the existing `subgraph_operations` table — no migration.

### Patch Changes

- Updated dependencies [a777de7]
- Updated dependencies [80433eb]
- Updated dependencies [e0f9499]
- Updated dependencies [a9be0a3]
- Updated dependencies [22725d0]
  - @secondlayer/sdk@6.9.0
  - @secondlayer/shared@6.18.0
  - @secondlayer/indexer@1.12.2
  - @secondlayer/platform@0.0.15

## 1.17.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@6.8.0
  - @secondlayer/shared@6.17.0

## 1.17.0

### Minor Changes

- 56bc457: feat: direct chain-level subscriptions (webhooks on chain events, no subgraph)

  Subscriptions are now polymorphic: a `subgraph` subscription fires on a deployed subgraph's table rows (unchanged), or a new `chain` subscription fires on raw chain events directly — a webhook on a contract / event-type / function-call, or any SIP-010/SIP-009/custom trait — with no subgraph to deploy.

  - SDK: `subscriptions.create({ triggers: [...] })` plus `on.*` trigger builders (`on.contractCall`, `on.ftTransfer`, …). New `ChainTrigger` / `SubscriptionKind` types; `SubscriptionDetail` gains `kind` + `triggers`.
  - Built on the public Index/Streams clock (reuses the subgraph re-point's `PublicApiBlockSource` + matcher); forward-looking (starts at tip, never backfills).
  - Reorg-safe apply/rollback delivery envelope (`chain.{type}.apply` / `chain.reorg.rollback`); per-subscription HMAC signing and all delivery formats reused unchanged.
  - Trait-scoped triggers require the contract registry (`CONTRACT_REGISTRY_ENABLED=true`).

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@6.7.0
  - @secondlayer/shared@6.16.0
  - @secondlayer/subgraphs@3.7.0

## 1.16.4

### Patch Changes

- 285f7a5: Fix 500s on /v1/index/transactions, /contract-calls, and /mempool when a decoded contract-call arg/result is a Clarity uint/int (cvToValue yields a BigInt, which throws in JSON.stringify and the ETag). Decoded values are now deep-converted to strings via jsonSafeBigInt.

## 1.16.3

### Patch Changes

- 30033cf: Expose raw hex `function_args_hex` on `/v1/index/transactions` (the `contract_call` sub-object) alongside the decoded `function_args`, for consumers that decode ClarityValues themselves (`decode(function_args_hex[i]) === function_args[i]`). Used by the subgraph runtime's Index source to reconstruct contract_call transactions identically to the DB tap.
- 7fc3cf9: Add an internal Index read credential (`@secondlayer/shared/index-internal-auth`), seeded into the Index token store as an unmetered enterprise tenant (no `account_id`). Lets first-party consumers — the subgraph processor — read `/v1/index` over HTTP without self-metering. Resolves from `INDEX_INTERNAL_API_KEY`.
- Updated dependencies:
  - @secondlayer/sdk@6.6.0
  - @secondlayer/shared@6.15.0
  - @secondlayer/subgraphs@3.6.0

## 1.16.2

### Patch Changes

- 9e3223b: Fix O(n²) keyset pagination on `/v1/index/events` for bare event-type sources. Adds a `(event_type, block_height, event_index)` partial composite index (migration 0087) and rewrites the cursor predicate to the sargable row-values tuple form `(block_height, event_index) > (X, Y)`. Without both, the non-sargable `OR` keyset made the planner bitmap-scan the entire event-type partition on every page (e.g. ~4.2M `print` rows, ~6.8s/page); it is now an index-only range scan (~0.37ms/page).
- Updated dependencies:
  - @secondlayer/shared@6.14.1

## 1.16.1

### Patch Changes

- 65b7839: Add a `contract_id` filter to `/v1/index/mempool` (and `sl.index.mempool.list/walk({ contractId })`) — watch pending calls to a single contract in one query, for keepers and agent feeds.
- Updated dependencies:
  - @secondlayer/indexer@1.12.1
  - @secondlayer/sdk@6.5.0

## 1.16.0

### Minor Changes

- 4b96a8a: Add mempool (pending transactions) to the Index API.

  The indexer now persists unconfirmed transactions from the Stacks node's `/new_mempool_tx` observer callback (deriving the txid from raw_tx), evicts them on confirmation (block ingest) or drop (`/drop_mempool_tx`), and sweeps stuck rows. The Index API serves them at `GET /v1/index/mempool` (filter by `sender`/`type`, cursor-paginated) and `GET /v1/index/mempool/:tx_id` — full pending-transaction documents (fee/nonce/post-conditions decoded from raw_tx), minus the block-anchored fields, plus `received_at`. Mempool reads are never cacheable (volatile). New SDK client: `index.mempool` (`list`/`walk`/`get`).

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.12.0
  - @secondlayer/sdk@6.4.0
  - @secondlayer/shared@6.14.0

## 1.15.0

### Minor Changes

- 6088df9: Expand the Index API with canonical block-hash map, blocks, full transaction documents, and PoX-4 stacking, plus finality-gated HTTP caching across all Index reads.

  New endpoints: `GET /v1/index/canonical`, `/v1/index/blocks` (+ `/:height_or_hash`), `/v1/index/transactions` (+ `/:tx_id`, full documents with fee/nonce/post-conditions decoded from `raw_tx`), and `/v1/index/stacking`. All Index responses now carry `Cache-Control` and ETag/304 for finalized ranges. New SDK clients: `index.canonical`, `index.blocks`, `index.transactions`, and `index.stacking` (each with `list`/`walk`, and `get` for blocks/transactions).

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@6.3.0

## 1.14.0

### Minor Changes

- 982f2bb: Add a wrong/empty Postgres volume guard. `checkChainDataIntegrity` flags the case where the chain tip is high but the deep history it implies is missing — the signature of a container recreated against a fresh/empty data dir. The indexer logs a loud `DB INTEGRITY ALERT` on startup (fail-closed with `REQUIRE_INTEGRITY=true`), and `/public/status` now reports `chainIntegrity` and degrades the top-level status on failure (without marking a core service down). Closes the blind spot where the DB read "healthy" on freshness while serving an empty volume.

### Patch Changes

- 1bb6a30: Dataset cursor-paginated routes now share one `cursorRoute` helper instead of copy-pasted validate→tip→503→respond boilerplate; the 503 empty-envelope row key and the tip guard live in one place, removing drift between the block-height and burnchain variants. No response-contract change.
- Updated dependencies:
  - @secondlayer/bundler@0.3.9
  - @secondlayer/indexer@1.11.0
  - @secondlayer/sdk@6.1.0
  - @secondlayer/shared@6.13.0

## 1.13.0

### Minor Changes

- 655db50: Add exclusion and multi-value filters to the Streams events firehose. `not_types` excludes event types, and `contract_id`, `sender`, and `recipient` now accept comma-separated lists (matching any value). Exposed on `GET /v1/streams/events`, the SDK (`events.list/consume/stream` accept `notTypes` and `string | string[]` filters), and the `sl streams events`/`consume` CLI (`--not-types`, `--sender`, `--recipient`, comma lists on `--contract-id`).

  No new indexes: `not_types` narrows the existing `type IN (...)` set and the list filters reuse the same range-bounded `events.data` access path as the single-value filters, so the query plan is unchanged.

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.10.0
  - @secondlayer/sdk@6.0.0
  - @secondlayer/shared@6.12.0

## 1.12.0

### Minor Changes

- c30aad3: Streams read endpoints now set finality-gated `Cache-Control`. Pages whose range is fully past the finality boundary (closed `to_height ≤ finalized_height`, a finalized single block/tx) are served `public, max-age=31536000, immutable`; tip-spanning and default requests stay `private, max-age=2` so a shared cache never serves stale tip data.
- c6a7e04: Streams finalized pages now support conditional requests: immutable `/events` pages carry a weak `ETag` and `/canonical/:height` honors `If-None-Match`, returning `304 Not Modified` on a match (before metering). Lets clients and caches revalidate cheaply.
- 48a8b08: Streams events now support `sender`, `recipient`, and `asset_identifier` filters on `/v1/streams/events` (and the SDK `events.list`/`consume`/`stream`), matching Index's principal/asset filters. They apply as exact-match predicates on the raw event payload, so event types lacking the field simply don't match — the firehose narrows naturally. Closes the query-parity gap with Index.
- 9ee756c: Streams responses are now signed with ed25519 when `STREAMS_SIGNING_PRIVATE_KEY` is set: every read response carries `X-Signature` (over the exact body) + `X-Signature-KeyId`, and the public key is published at `GET /public/streams/signing-key`. Signing is off (no headers) when the key is unset, so it ships safely before provisioning.
- f6bfe8f: `GET /v1/streams/tip` now returns `finalized_height` — the highest Stacks block past the burn-confirmation finality boundary, computed from the tip's `burn_block_height`. Lets consumers tell which blocks are immutable.

### Patch Changes

- bfa74db: Centralize the Streams cursor codec in `@secondlayer/shared` (`encodeStreamsCursor`, `decodeStreamsCursor`, `EMPTY_RANGE_EVENT_INDEX_SENTINEL`). The API and indexer now delegate to one implementation instead of three near-identical copies, so encode/decode and the empty-range sentinel can't drift between products.
- ef9e4be: Add an in-process origin cache for finalized Streams event pages. Immutable pages (resolved range past the finality boundary) memoize their event payload and skip the Postgres read on repeat, attaching the fresh tip per request. Bounded LRU; per-tenant rate-limit/metering still run on every request.
- Updated dependencies:
  - @secondlayer/indexer@1.9.0
  - @secondlayer/sdk@5.9.0
  - @secondlayer/shared@6.11.0

## 1.11.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.7.0
  - @secondlayer/shared@6.10.0

## 1.11.0

### Minor Changes

- ae8b749: Add a typed Datasets client and `sl datasets` CLI command for the Foundation Datasets (`/v1/datasets/*`) — previously HTTP-only. The SDK `Datasets` client offers uniform `list`/`walk` (cursor) for the event datasets (sBTC, BNS, PoX-4, STX transfers) plus bespoke methods for BNS names/namespaces/resolve and network-health. `sl datasets list` / `sl datasets query <dataset> --filter k=v` query from the terminal. Adds an `address` super-filter to the pox-4 calls dataset that matches a stacker's activity across any role (caller, stacker, or delegate_to).
- 948c0d5: Add `in`/`notIn`/`like` filter operators and deterministic multi-column ordering to the subgraph query client. `findMany`/`count` now accept `{ col: { in: [...] }, name: { like: "a%" } }` and `orderBy: [["blockHeight","desc"],["id","asc"]]`. All values are parameterized server-side (`IN ($1,$2,…)`); `in`/`notIn` are comma-encoded over REST so values cannot contain commas.

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.6.0
  - @secondlayer/subgraphs@3.4.0

## 1.10.0

### Minor Changes

- 0c3ba82: Add bring-your-own-database support to subgraphs. Deploy with `sl subgraphs deploy <file> --database-url <postgres-url>` to write a subgraph's schema, handler rows, and serving reads to your own Postgres while the managed pipeline still ingests, decodes, matches, and runs your handler. The connection string is stored encrypted at rest and never returned. Handler writes must be idempotent (insert/upsert); reindex is unavailable on BYO subgraphs (re-deploy to rebuild), and deleting a BYO subgraph never drops the schema in your database.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.9.0
  - @secondlayer/subgraphs@3.3.0

## 1.9.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.8.1

## 1.9.0

### Minor Changes

- 4657c71: Index now serves `stx_lock` (stacking lock) events via `GET /v1/index/events?event_type=stx_lock`. The locked principal maps to `sender`, the locked uSTX to `amount`, and `unlock_height` rides in `payload` (`{ unlock_height }`) — filterable by `sender`. SDK adds `decodeStxLock` / `isStxLock` + `DecodedStxLock` types and the `IndexStxLock` client variant. No migration: reuses the existing `decoded_events.payload` jsonb column.

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.7.0
  - @secondlayer/sdk@5.5.0

## 1.8.0

### Minor Changes

- 8557963: Index now serves decoded contract-call transactions. `GET /v1/index/contract-calls` returns each `contract_call` tx with its decoded `function_name`, positional `args` (Clarity values decoded to JSON), `result`, and `result_hex` — filterable by `contract_id`, `function_name`, and `sender`, cursor-paginated on `<block_height>:<tx_index>`. Sourced from the transactions table (canonical via block height); always returns `reorgs: []`.

  SDK exports `decodeClarityValue` / `toJsonSafe` (a hex-Clarity-value → JSON-safe decoder, now shared by the print decoder and reusable by callers).

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.3.0

## 1.7.0

### Minor Changes

- 81fc2d8: Index now decodes and serves Clarity `print` events. `GET /v1/index/events?event_type=print` returns each print's `topic`, the Clarity `value` decoded to JSON (uints as strings, buffers as `0x…` hex, tuples as objects), and the canonical `raw_value` hex — filterable by `contract_id`.

  SDK adds `decodePrint` / `isPrint` and the `DecodedPrint` types (depends on `@secondlayer/stacks` for Clarity decoding). A nullable `payload` JSONB column is added to `decoded_events` to hold decoded values that don't fit the flat transfer columns. The indexer runs a `print` decoder; the API registry and OpenAPI expose it.

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.6.0
  - @secondlayer/sdk@5.2.0
  - @secondlayer/shared@6.8.0

## 1.6.0

### Minor Changes

- 239e2f2: Index now decodes and serves STX transfers, mints, and burns for tokens. `GET /v1/index/events` accepts `event_type` of `stx_transfer`, `stx_mint`, `stx_burn`, `ft_mint`, `ft_burn`, `nft_mint`, and `nft_burn` alongside the existing transfer types.

  SDK adds `decodeStxTransfer`, `decodeStxMint`, `decodeStxBurn`, `decodeFtMint`, `decodeFtBurn`, `decodeNftMint`, `decodeNftBurn` (plus their decoded types, `is*` guards, and the `DecodedEventColumns` helper) and widens `DecodedEventRow` to the full set. The indexer runs a decoder per new type; the API registry and OpenAPI expose them with per-type filters.

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.5.0
  - @secondlayer/sdk@5.1.0

## 1.5.11

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.4.3
  - @secondlayer/sdk@5.0.0

## 1.5.10

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.7.0

## 1.5.9

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.6.0

## 1.5.8

### Patch Changes

- ba36d64: Replace the waitlist/early-access gate with open signup. Any email can request a magic link and an account is created on verify. Removes the waitlist table, admin approval routes, and confirmation/approval emails.
- Updated dependencies:
  - @secondlayer/shared@6.4.4

## 1.5.7

### Patch Changes

- Updated dependencies:
  - @secondlayer/bundler@0.3.6
  - @secondlayer/sdk@4.0.1
  - @secondlayer/subgraphs@3.0.0

## 1.5.6

### Patch Changes

- 201cd1b: Fix subgraph redeploy silently dropping schema/handler changes. Bun's import() ignores ?query cache-busting for file URLs, so reusing a per-name handler file re-ran a stale cached module on every redeploy. Each deploy now writes a unique handler filename (and prunes prior ones) so the definition is always loaded fresh.
- Updated dependencies:
  - @secondlayer/subgraphs@2.0.9

## 1.5.5

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.4.2
  - @secondlayer/sdk@4.0.0

## 1.5.4

### Patch Changes

- cdfa9de: Clarify BNS-V2 scope in OpenAPI summaries — `/v1/datasets/bns/*` endpoints now identify as BNS-V2 in the discovery surface.
- 8bdce83: Bound cursor pagination to `cursor.block_height` instead of 0. Paginated dataset requests (stx-transfers, sbtc, bns, pox-4) previously scanned full event history on every page (~30s timeout). The cursor predicate already enforces strict `>`, so the lower-bound shrink is safe.

## 1.5.3

### Patch Changes

- 877d29c: rename bns/name-events → bns/events, add tip to bns/names response, add X-RateLimit headers to datasets surface

## 1.5.2

### Patch Changes

- e77d010: hint at underscore prefix when bare limit/offset/sort used in subgraph queries; reject x-api-key header on Index with clear error

## 1.5.1

### Patch Changes

- b2db8c2: add rate-limit headers to anonymous Index reads via shared open-beta bucket
- a31d857: fix unknown filter ops, limit message consistency, subgraph HTTPS server url, subscription delete not-found

## 1.5.0

### Minor Changes

- 3da36df: Reorg + data model polish:

  - Streams event rows now include `canonical: true` so clients can write type-safe reorg-aware code. (Field is optional in the SDK type to preserve backwards compatibility.)
  - Index `/v1/index/ft-transfers` and `/v1/index/nft-transfers` row projections now include `block_time` (ISO 8601 UTC, sourced via subquery on the canonical block).
  - Streams cursor-less default window tightened from `tip - 1 day` (~17280 blocks) to `tip - 1000 blocks` (~80 min) so first-touch responses surface recent data instead of stale events ~17k blocks behind tip. Indexer-style backfill consumers should pass `from_height=0` or an explicit cursor as before.
  - `microblock_hash` field on events deferred — requires a `blocks` table schema change; tracked separately.

- 7d33b80: Split CORS: public read surfaces (`/v1/*`, `/health`, `/public/*`) now use `Access-Control-Allow-Origin: *` (no credentials) so browsers from any third-party origin can fetch datasets, index, and streams. `/api/*` keeps the dashboard allowlist + credentials for session-cookie / Bearer-mutation routes. Exposes rate-limit headers (`X-RateLimit-*`, `Retry-After`, `ETag`) on public responses. Unmatched routes now always return JSON `{error, code:"NOT_FOUND", path}` instead of text/plain 404.
- 305a7ea: Strict query validation across public surfaces — Datasets, Index, Streams, and Subgraphs REST now reject unknown query params with `400 VALIDATION_ERROR` (with "did you mean…" hint) instead of silently ignoring them. `limit=0` is now rejected; `limit` is still capped at 1000. Subgraph REST filter parser now returns `400` (not `500`) on unknown ops like `?col.bogus=X`, and detects misplaced operators like `?col=gt.X`. Adds optional `sl subgraphs deploy --strict` flag to run `tsc --noEmit` against the handler before deploy.
- bfa3d2e: `/v1` discovery surface — `GET /v1` returns surface index (datasets, index, streams). `GET /v1/datasets`, `/v1/streams`, `/v1/index` each return route + filter inventory. Hand-authored OpenAPI 3.1 spec at `/v1/openapi.json` covering all public surfaces (datasets, index, streams). Adds a friendly `/api/subgraphs/<name>/openapi → openapi.json` redirect (was previously matched as a table name and returned 404 TABLE_NOT_FOUND).

### Patch Changes

- fc8f486: Housekeeping polish:

  - Dropped fictitious typed-key prefixes (`sk-sl_streams_…`, `sk-sl_index_…`) from marketing copy + sandbox placeholder. Real keys are generic `sk-sl_…`; scoped prefixes were doc fiction.
  - Index rate-limit 429 for free tier now returns `{required_tier, upgrade_url}` so blocked users know how to unblock.
  - `sl subgraphs status <name> --watch` polls every 2s, clearing screen between snapshots, exits cleanly when synced.
  - `standard-webhooks.ts` docstring clarified that only `.created` is emitted in v1; `.updated`/`.deleted` are deferred.
  - T8.6 `sl subgraphs logs` deferred — needs server-side log storage.
  - T8.3 broken tenant URL strip is `[infra]`, tracked in ops backlog.

- Updated dependencies:
  - @secondlayer/indexer@1.4.1
  - @secondlayer/shared@6.4.1
  - @secondlayer/subgraphs@2.0.2

## 1.4.0

### Minor Changes

- 4f0e675: Delete the dedicated-provisioning surface: `/api/tenants` routes, `provisioner-client`, `ephemeral-jwt` minting, `dedicatedAuth` JWT middleware, and the post-stripe-webhook tenant suspend block. The `@secondlayer/provisioner` package is removed from the workspace. Subgraphs + subscriptions are served from the shared platform; per-tenant containers, JWTs, and the tenant lifecycle UI have no remaining call sites.

### Patch Changes

- a099bb7: Delete the dedicated-mode `trackTenantActivity` middleware and `/internal/activity` endpoint. The worker cron that consumed them is gone post shared-rip; nothing reads `getLastRequestAtMs` anymore.
- 6ec2143: Add parquet exporters for `pox-4/calls`, `bns/name-events`, `bns/namespace-events`, `bns/marketplace-events`. Each ships behind its own `*_PUBLISHER_ENABLED` flag (no auto-on). Register the four new slugs in the `/v1/datasets/*` manifest map.

  Refactors: extract `datasets/_shared/exporter.ts`, `scheduler.ts`, `parquet.ts` so adding new families is now a ~5-file, column-driven addition rather than a copy-paste of the sBTC pattern. Existing sBTC + STX-transfers families switched to the shared factories; output byte-identical.

  Add `bun run --filter @secondlayer/indexer datasets:backfill <slug> --from <block> --to <block>` to walk historical ranges and upload.

- Updated dependencies:
  - @secondlayer/indexer@1.4.0
  - @secondlayer/shared@6.4.0

## 1.3.11

### Patch Changes

- c3b90e8: Allow anonymous reads on `/v1/index/ft-transfers` and `/v1/index/nft-transfers`. Bearer middleware now passes through when no `Authorization` header is present; keyed flow (tier validation, metering, rate limiting) still runs for requests that send a token.
- Updated dependencies:
  - @secondlayer/shared@6.3.5
  - @secondlayer/subgraphs@2.0.1

## 1.3.10

### Patch Changes

- 4c496b4: restore Bun.serve idleTimeout (10s → 90s). The fix originally landed in `0650816b` for slow streams queries; was silently reverted in `9a4c8d35` and resurfaced as a fresh UX bug: `sl subgraphs delete` against a mid-reindex subgraph completes server-side in ~14s but the client sees "Server error" because Bun closes the socket at the default 10s. Long-tail operations include the `waitForSubgraphOperationsClear` poll (up to 30s), jsonb scans during BNS backfill (5–20s), and dense streams page reads. 90s covers all known cases with headroom. Code comment now flags the prior revert so this doesn't get undone again.

## 1.3.9

### Patch Changes

- ca2e7a6: fix deploy.sh leaving prod in mixed-version state when wait-for-healthy fails. Previously `.env` was only updated by `record_successful_deploy()` at end-of-script — a failed health check meant new containers were running but `.env` still pointed at the OLD tag, causing any subsequent manual `docker compose up -d <service>` to silently roll the service back. Now pins `.env` immediately after `docker compose up -d`, separate from the state-dir markers in `record_successful_deploy()`. State-dir markers still only update on full success — they represent "last verified good deploy" (separate concept from "what's running now").
- e1b68e9: fix subgraph delete 500-ing mid-reindex. Previously the route set `cancel_requested: true` and immediately ran `DROP SCHEMA ... CASCADE`, which blocked behind the live reindex transaction until the API socket timed out → generic 500. Adds `waitForSubgraphOperationsClear` (polls until active ops drain or 30 s timeout) and calls it after requesting cancel. The processor observes `cancel_requested` at batch boundaries (typically <5 s) and releases its row + advisory locks; DROP SCHEMA then proceeds cleanly. If the timeout elapses, the route logs a warning and proceeds anyway — preserves current behavior for the pathological case.
- Updated dependencies:
  - @secondlayer/shared@6.3.3

## 1.3.8

### Patch Changes

- 7b43cb3: loosen `nearTip` threshold from 60s → 300s. Under the AND-with-OR health logic shipped same-cycle, a sparse-but-keeping-up decoder (sBTC, BNS-V2 during quiet windows) would falsely flag unhealthy any time its checkpoint drifted more than a few blocks behind tip while no events matched its filter. 5 min tolerates normal block-time variance + sparse-event arrival without masking truly stuck decoders, which sit hours behind tip.
- Updated dependencies:
  - @secondlayer/indexer@1.3.13

## 1.3.7

### Patch Changes

- aac8f1f: fix two L2 decoder health bugs that surfaced during the 2026-05-12 BNS backfill experiment.

  (1) `getL2DecoderHealth` reported `status: ok` for decoders stuck in error-retry loops. The `runDecoder` `finally` block bumps `checkpoint.updated_at` every iteration as a liveness ping — `checkpointRecent` was true even when the decoder was failing every fetch. Treated heartbeat as sufficient. Now treat it as necessary: status is healthy only when the heartbeat is recent AND there's a real-work signal (`nearTip` or `writesRecent`). Decoder stuck mid-history with no writes now correctly reports unhealthy in ~5 min instead of forever.

  (2) `lag_seconds` returned ~1.78B (~56 years) when checkpoint moves backwards onto a block whose row in the `blocks` table has `timestamp = 0` (a historical bulk-import artifact). Added a defensive `timestamp > 0` guard; returns `null` for the unmeasurable case, matching the existing "no checkpoint yet" shape that dashboards already handle.

- Updated dependencies:
  - @secondlayer/indexer@1.3.12
  - @secondlayer/sdk@3.5.4

## 1.3.6

### Patch Changes

- 383cdf4: fix deploy.sh silently redeploying the previous SHA. `docker/scripts/deploy.sh` now snapshots `DEPLOY_IMAGE_OWNER/TAG/SHA` from the deploy invocation BEFORE sourcing `.env`, then re-applies them on top. Without this, the `record_successful_deploy` step from the prior fix would persist these keys into `.env` and then `source .env` would override the next deploy's env vars with the previous deploy's tag — making every subsequent deploy a silent rollback. Companion change in `scripts/ci/post-deploy-smoke.sh` asserts `/health.image_sha` matches `$EXPECTED_DEPLOY_SHA` (wired from `${{ github.sha }}` in the workflow) so this failure mode fails the deploy job instead of going green.
- Updated dependencies:
  - @secondlayer/sdk@3.5.3

## 1.3.5

### Patch Changes

- 0dffe25: `/v1/datasets/bns/names` now supports cursor pagination via `?cursor=<bns_id>` and rejects the previously-silent `offset` param. Response shape gains `next_cursor: string | null`, matching the envelope used by the other dataset endpoints. Order changed from `fqn ASC` to `bns_id ASC` (the on-chain mint sequence) for stable forward iteration.
- fda87d8: `/v1/datasets/bns/namespaces` now distinguishes "no namespace events ever" from "backfill hasn't reached the era when .btc / .id were created". When the projection is empty AND the indexed range starts past the BNS-V2 history threshold, the response includes `status: 'backfill_pending'` and `earliest_indexed_block`. Mirrors the signal already emitted by `/v1/datasets/bns/resolve`.
- 9d1813a: `/v1/datasets/bns/resolve` now distinguishes "name not in indexed range" from "name does not exist". When `bns_names` earliest indexed block exceeds the BNS-V2 history threshold, the endpoint returns `503 BACKFILL_PENDING` with `earliest_indexed_block` instead of a generic `404`. Defends against the launch-day "muneeb.btc returns not found" failure mode while the historical backfill catches up.
- 5b03de0: surface deploy SHA on `/health` so drift is detectable without shelling in

  `GET /health` now returns `{ status: "ok", image_sha }` where `image_sha` is the git SHA the Deploy workflow built this container from. Companion change to `docker/scripts/deploy.sh` persists `DEPLOY_IMAGE_OWNER` / `DEPLOY_IMAGE_TAG` into `/opt/secondlayer/docker/.env` after a successful deploy so subsequent manual `docker compose up -d <service>` no longer falls back to compose-file defaults and silently rolls a service back to a different image.

- 321ebca: split sbtc decoder into registry + token, narrow filter to avoid socket timeouts

  `l2.sbtc.v1` previously fetched `print` + `ft_transfer/mint/burn` events across all contracts with `batchSize: 500` and no server-side filter, mirroring the unfiltered scan bug BNS already fixed — the upstream socket closes mid-response on long-running historical scans. Split into two decoders backed by one source file:

  - `l2.sbtc.v1` — registry `print` events on `<network>.sbtc-registry`, writes `sbtc_events`
  - `l2.sbtc_token.v1` (new checkpoint) — `ft_transfer/mint/burn` on `<network>.sbtc-token`, writes `sbtc_token_events`

  Each uses `batchSize: 100` and a server-side `contractId` filter selected via `STACKS_NETWORK`. `/public/status` reports both via `status.ts` mapping. `getEnabledL2DecoderNames` and the health-module `readLatestDecodedAt` switch surface the new decoder too. Existing `l2.sbtc.v1` checkpoint preserved.

- Updated dependencies:
  - @secondlayer/indexer@1.3.11
  - @secondlayer/sdk@3.5.2

## 1.3.4

### Patch Changes

- 936026a: enable promotion codes on Stripe Checkout — sets `allow_promotion_codes: true` so users can redeem coupon codes at upgrade, including founder/friend comp codes
- 7f4a5a2: cap empty-range cursor sentinel at int4 max so the next fetch doesn't 500

  The earlier sentinel `Number.MAX_SAFE_INTEGER` overflowed Postgres `integer` (int4) when used as a query parameter against `stream_event_index`, so the very fetch that was supposed to advance past an empty filtered range threw `value "9007199254740991" is out of range for type integer` and pinned the decoder.

- 55848a6: fix decoder freeze when server-side filter eliminates every event in scanned range

  `readCanonicalStreamsEvents` advances `next_cursor` past `toHeight` instead of returning `null` for empty filtered scans — fixes BNS/FT decoders that pinned at previous cursor and spun forever in `consume()`.

  `runDecoder` passes `maxEmptyPolls: 1` so `consume()` returns periodically and the liveness ping keeps `l2_decoder_checkpoints.updated_at` fresh.

  Status route drops unimplemented `reorgs.last_24h`.

- 5092494: add `sl billing status` — read-only snapshot of plan, Stripe subscription, trial end, renewal date, and applied discount. Backed by new `GET /api/billing/status` endpoint. Lets customers verify post-checkout that the webhook landed before retrying `sl instance create`.
- Updated dependencies:
  - @secondlayer/indexer@1.3.10

## 1.3.3

### Patch Changes

- 9a4c8d3: perf(events): expression index on `data->>'contract_identifier'`

  Print-event scans filtered by contract used to fall back to a sequential scan of the events table (53M+ rows on mainnet) — query took 2-3s at limit=100, 5-20s at limit=500, surfacing as `socket connection was closed unexpectedly` errors in the L2 BNS decoder. New partial expression index `events_contract_event_contract_id_idx` brings those queries to ~1ms via Index Scan.

  - `@secondlayer/shared@*`: ships migration `0073_events_contract_id_idx.ts` (`CREATE INDEX IF NOT EXISTS …`). The index was already applied to prod via `CREATE INDEX CONCURRENTLY` on 2026-05-09; the migration is a no-op there but seeds dev/staging.
  - `@secondlayer/api@*`: reverts the `Bun.serve idleTimeout: 60` workaround introduced 2026-05-09 — back to default. Indexed query no longer needs the extended timeout.

- Updated dependencies:
  - @secondlayer/shared@6.3.1

## 1.3.2

### Patch Changes

- 0650816: fix(api): raise Bun.serve idleTimeout 10 → 60s

  Slow streams queries (the unindexed jsonb scan that backs `types=print&contract_id=...`) regularly take 5–20s on backfill. Bun's default 10s idle timeout was closing the socket mid-response, surfacing as `socket connection was closed unexpectedly` in downstream consumers (the L2 BNS decoder, which then sat at the same checkpoint forever).

## 1.3.1

### Patch Changes

- f041151: fix(api): public status surfaces every enabled L2 decoder

  `/public/status.index.decoders[]` was hardcoded to `[ft, nft]` even when sbtc/pox4/bns were running. The list now derives from the same `*_DECODER_ENABLED` env flags the indexer reads, via a re-exported `getEnabledL2DecoderNames()` from `@secondlayer/indexer/l2/health`.

- Updated dependencies:
  - @secondlayer/indexer@1.3.4

## 1.3.0

### Minor Changes

- 4cf176f: Add BNS Foundation Dataset — closes the 5-dataset shelf alongside STX Transfers, sBTC, PoX-4, and Network Health.

  **Decoder** (`l2.bns.v1`): subscribes to BNS-V2 contract print events, dispatches on three discriminator keys (`topic` for names, `status` for namespaces, `a` for marketplace), writes into 3 event tables and maintains 2 current-state projections (`bns_names`, `bns_namespaces`). Gated on `BNS_DECODER_ENABLED`.

  **API** (`/v1/datasets/bns/*`): six endpoints — `name-events`, `namespace-events`, `marketplace-events`, `names`, `namespaces`, `resolve?fqn=alice.btc`. Cursor pagination on event endpoints; current-state lookups against the projections.

  **Marketing**: `/datasets/bns` detail page, BNS flipped to "shipped" on the dataset index. Mainnet-only for v0; BNS-V1 historical data and subdomain resolution out of scope.

### Patch Changes

- Updated dependencies:
  - @secondlayer/indexer@1.3.0

## 1.2.0

### Minor Changes

- ede1227: Add `/v1/datasets/pox-4/calls` endpoint with filters (`function_name`, `stacker`, `delegate_to`, `signer_key`, `reward_cycle`, `from_block`, `to_block`) and tx-grain cursor pagination. Reads from the `pox4_calls` table populated by the `l2.pox4.v1` decoder. Marketing surface: `/datasets/pox-4` detail page; PoX-4 flipped to "shipped" on the dataset index.

## 1.1.8

### Patch Changes

- 4768a60: Add sBTC parquet publishers (events + token-events) under `stacks-datasets/mainnet/v0/sbtc/{events,token-events}/`. Single `SBTC_PUBLISHER_ENABLED` flag gates both. Manifest registry now exposes `sbtc-events` + `sbtc-token-events` slugs.
- Updated dependencies:
  - @secondlayer/indexer@1.1.0

## 1.1.7

### Patch Changes

- Updated dependencies:
  - @secondlayer/bundler@0.3.5
  - @secondlayer/shared@6.0.0
  - @secondlayer/subgraphs@2.0.0

## 1.1.6

### Patch Changes

- Updated dependencies:
  - @secondlayer/bundler@0.3.4
  - @secondlayer/shared@5.0.0
  - @secondlayer/subgraphs@1.3.3

## 1.1.5

### Patch Changes

- 1a3a80d: Harden tenant runtime environment injection, subgraph operation cleanup, subscription scoping, and destructive CLI error handling.
- Updated dependencies [1a3a80d]
  - @secondlayer/subgraphs@1.3.2
  - @secondlayer/shared@4.3.3

## 1.1.4

### Patch Changes

- [`4462afd`](https://github.com/ryanwaits/secondlayer/commit/4462afded306504a9cac1bf4559333bf3d79e6d8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Stabilize subgraph deploys by importing generated handlers through file URLs,
  evaluating bundled subgraphs from temporary modules instead of data URIs, and
  adding a CLI deploy dry-run preview. ABI scaffolding now reports the actual
  Secondlayer node source and fails quickly when contract fetches are unavailable.
- Updated dependencies [[`4462afd`](https://github.com/ryanwaits/secondlayer/commit/4462afded306504a9cac1bf4559333bf3d79e6d8)]:
  - @secondlayer/bundler@0.3.2
  - @secondlayer/subgraphs@1.2.1

## 1.1.3

### Patch Changes

- Inline the private `@secondlayer/auth` package under the API package so auth routes, middleware, rate limiting, key helpers, and email helpers are owned by `@secondlayer/api`.

- Updated dependencies []:
  - @secondlayer/subgraphs@1.2.0
  - @secondlayer/shared@4.1.1

## 1.1.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@4.0.0
  - @secondlayer/subgraphs@1.1.0
  - @secondlayer/auth@0.1.18

## 1.1.1

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8), [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64)]:
  - @secondlayer/shared@3.0.0
  - @secondlayer/subgraphs@1.0.0
  - @secondlayer/auth@0.1.17
  - @secondlayer/bundler@0.3.1

## 1.1.1-alpha.0

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2)]:
  - @secondlayer/shared@3.0.0-alpha.0
  - @secondlayer/subgraphs@1.0.0-alpha.0
  - @secondlayer/auth@0.1.17-alpha.0
  - @secondlayer/bundler@0.3.1-alpha.0

## 1.1.0

### Minor Changes

- [`2024259`](https://github.com/ryanwaits/secondlayer/commit/2024259c0a474dcede50fa8d6fb4018877632435) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Production hardening for dedicated hosting.

  - Per-tenant `pg_dump` backups on an hourly + daily retention ladder; systemd units + Storage Box upload.
  - Agent monitors tenant-pg backup freshness, tenant container health (unhealthy + sustained memory pressure).
  - SSH bastion container gives tenants a direct `DATABASE_URL` via `ssh -L`. New endpoints: `GET /api/tenants/me/db-access`, `POST/DELETE /api/tenants/me/db-access/key`. New CLI: `sl instance db`, `sl instance db add-key <path>`, `sl instance db revoke-key`.
  - `tenant_usage_monthly` table records peak/avg/last storage per month for future billing.
  - `provisioning_audit_log` table captures provision/resize/suspend/resume/rotate/teardown/bastion events.
  - Marketplace removed across the monorepo (SDK, shared schemas + queries, API routes, CLI command, dashboard pages + routes). DB migration for the `0022_marketplace` columns intentionally not reverted — profile columns on accounts are kept for general use; `is_public/tags/description/forked_from_id` stay on `subgraphs` as history and can be dropped in a later migration.

### Patch Changes

- Updated dependencies [[`2024259`](https://github.com/ryanwaits/secondlayer/commit/2024259c0a474dcede50fa8d6fb4018877632435)]:
  - @secondlayer/shared@2.1.0

## 1.0.2

### Patch Changes

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0
  - @secondlayer/auth@0.1.16
  - @secondlayer/subgraphs@0.11.8

## 1.0.1

### Patch Changes

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01)]:
  - @secondlayer/bundler@0.3.0
  - @secondlayer/shared@1.1.0
  - @secondlayer/subgraphs@0.11.7

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

### Minor Changes

- [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Server-side subgraph bundler + source capture, mirroring the workflows authoring loop.

  - **API**: new `POST /api/subgraphs/bundle` runs `bundleSubgraphCode` from `@secondlayer/bundler` and returns `{ name, version, sources, schema, handlerCode, sourceCode, bundleSize }`. `BundleSizeError → 413`, other failures → 400 with `code: "BUNDLE_FAILED"`. New `GET /api/subgraphs/:name/source` returns the original TypeScript source for deployed subgraphs, or a `readOnly` payload for rows predating the migration. `POST /api/subgraphs` now threads `sourceCode` through `deploySchema` so the original source is persisted on deploy.
  - **SDK**: new `subgraphs.bundle({ code })` and `subgraphs.getSource(name)` methods + `BundleSubgraphResponse` / `SubgraphSource` types.
  - **shared**: migration `0031_subgraph_source_code` adds `source_code TEXT NULL` to the `subgraphs` table; `registerSubgraph` upsert + `DeploySubgraphRequest` schema both accept an optional `sourceCode` field (max 1MB).
  - **subgraphs**: `deploySchema()` accepts `sourceCode` in its options and forwards it to `registerSubgraph`.

  Unlocks the next wave of the chat authoring loop (read/edit/deploy/tail subgraphs in a session).

- [`d332f9c`](https://github.com/ryanwaits/secondlayer/commit/d332f9cb75638ff828ead721ce0e229100fd0e77) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Move workflow bundling from Vercel to the Hetzner API.

  - **API**: new `POST /api/workflows/bundle` route that accepts a TypeScript workflow source, runs `bundleWorkflowCode` from `@secondlayer/bundler`, and returns the bundled handler + extracted metadata. Mapped via the existing `/api/workflows/*` auth + rate-limit middleware. `BundleSizeError` → `HTTP 413`, other failures → `HTTP 400`. Logs every request with `x-sl-origin` + `bundleSize` for telemetry parity with deploy logs.
  - **SDK**: new `workflows.bundle({ code })` method plus `BundleWorkflowResponse` type.
  - **Web**: `POST /api/sessions/bundle-workflow` rewritten as a thin direct-fetch passthrough to the Hetzner API. `@secondlayer/bundler` is no longer a dependency of `apps/web` and `esbuild` is no longer in `serverExternalPackages`. Vercel cold starts drop esbuild's native binary from the hot path. CLI and MCP continue to bundle locally — this only affects the chat authoring loop.

  This fixes a class of `"Module evaluation failed: Cannot find module 'unknown'"` / `NameTooLong` / `Could not resolve "@secondlayer/workflows"` failures that kept surfacing when esbuild ran inside Vercel serverless functions. Chat deploy flow now goes Vercel → Hetzner `/api/workflows/bundle` → Hetzner `/api/workflows` → workflow-runner, all against stable workspace layouts.

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

- [`db333b1`](https://github.com/ryanwaits/secondlayer/commit/db333b1ea707516462f034ef13d37e5ff5fa01de) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Live-tail workflow runs over SSE:

  - API: new `GET /api/workflows/:name/runs/:runId/stream` Hono `streamSSE` route. Emits an initial snapshot of `workflow_steps`, polls every 500ms for status diffs, pushes `step`, `heartbeat`, `done`, and `timeout` events, and caps at 30 minutes (matches `logs.ts`).
  - SDK: typed `workflows.streamRun(name, runId, onEvent, signal)` plus shared `WorkflowStepEvent` / `WorkflowTailEvent` types. Uses the native `fetch` streaming response so callers can carry `x-sl-origin` headers alongside Bearer auth.
  - MCP: new `workflows_tail_run` tool that wraps `streamRun` and returns a compacted log of up to `limit` events or until the run completes / `timeoutMs` elapses — MCP is not streaming-first, so this is a bounded collect-and-return.
  - Web: new `tail_workflow_run` session tool that emits `{ name, runId }` and a client-side `StepFlowLive` component that opens an SSE proxy route (`/api/sessions/tail-workflow-run/[name]/[runId]`) and animates the `StepFlow` timeline as events arrive. The deploy-success card's **Tail live runs** CTA is now wired — it triggers a run if the user hasn't already, then mounts the live timeline in-card.

### Patch Changes

- [`6f45ae5`](https://github.com/ryanwaits/secondlayer/commit/6f45ae5ebd6bc0820180750003a644d43497f5e5) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Post-P1 workflows authoring loop polish.

  - **API**: `POST /api/workflows` and `/api/workflows/bundle` now auto-resolve session-auth requests to the account's first active API key, so chat deploys no longer 401 when the caller only has a session cookie.
  - **Web**: `manage_workflows` wired as a human-in-loop tool with a structured action handler (trigger/pause/resume/delete), so the card no longer hangs after approval.
  - **Web**: live step tail now renders each completed step's output (JSON-formatted) instead of only showing errors.
  - **Web**: run ID entries in the workflow runs table are now styled as accent-colored links pointing at the existing run detail page.

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.

  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.

- [`fbc8c95`](https://github.com/ryanwaits/secondlayer/commit/fbc8c9555d2978b7178e33e322330806920de91a) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Read / edit / diff loop for workflows:

  - Web: new session tools `read_workflow` (fetches stored source + version via `/api/workflows/:name/source`, graceful read-only fallback) and `edit_workflow` (HIL with diff card). A new `DiffCard` component renders server-rendered unified diff hunks; a companion `POST /api/sessions/diff-workflow` route pre-computes hunks via the `diff` package and shiki. Confirming the edit reuses the Sprint 3 bundle + deploy path with `expectedVersion`, surfaces 409s as "Stale vX.Y.Z" on the card, and the session instructions now enforce read → edit → confirm with the in-flight-run caveat.
  - API: `POST /api/workflows` now deletes any lingering `workflow_schedules` row when a workflow edit moves the trigger off `schedule`, so the cron worker stops firing the old schedule.
  - MCP: new `workflows_propose_edit` tool — fetches the deployed source, bundles the proposed source for validation only (no deploy), and returns `{ currentVersion, currentSource, proposedSource, diffText, bundleValid, validation, bundleSize }` so external agents can present a diff without committing.

- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f)]:
  - @secondlayer/shared@1.0.0
  - @secondlayer/subgraphs@0.11.6
  - @secondlayer/bundler@0.2.0
  - @secondlayer/auth@0.1.15

## 0.3.5

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.11.0
  - @secondlayer/shared@0.12.0
  - @secondlayer/auth@0.1.14

## 0.3.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0
  - @secondlayer/subgraphs@0.10.0
  - @secondlayer/auth@0.1.13

## 0.3.3

### Patch Changes

- Updated dependencies [885662d]
  - @secondlayer/subgraphs@0.9.0
  - @secondlayer/shared@0.10.1

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0
  - @secondlayer/subgraphs@0.8.0
  - @secondlayer/auth@0.1.12

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0
  - @secondlayer/auth@0.1.11
  - @secondlayer/subgraphs@0.7.2

## 0.3.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0
  - @secondlayer/subgraphs@0.7.0
  - @secondlayer/auth@0.1.10

## 0.2.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.6.0
  - @secondlayer/shared@0.7.1

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0
  - @secondlayer/auth@0.1.9
  - @secondlayer/subgraphs@0.5.7

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/auth@0.1.8
  - @secondlayer/subgraphs@0.5.6

## 0.2.1

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

- Updated dependencies []:
  - @secondlayer/shared@0.5.1
  - @secondlayer/auth@0.1.7
  - @secondlayer/subgraphs@0.5.5

## 0.2.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0
  - @secondlayer/subgraphs@0.5.0
  - @secondlayer/auth@0.1.6

## 0.1.6

### Patch Changes

- Add offset support to deliveries endpoint for proper pagination

## 0.1.5

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/views@0.3.0
  - @secondlayer/auth@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [48e42ba]
  - @secondlayer/shared@0.3.0
  - @secondlayer/auth@0.1.4
  - @secondlayer/views@0.2.4

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.2.3
  - @secondlayer/views@0.2.3
  - @secondlayer/auth@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.2.2
  - @secondlayer/views@0.2.2
  - @secondlayer/auth@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.2.1
  - @secondlayer/views@0.2.1
  - @secondlayer/auth@0.1.1

# @secondlayer/sdk

## 6.29.1

### Patch Changes

- x402's `resolveAccountNonce` now reads the account nonce through `@secondlayer/stacks`'s `getNonce` action instead of a hand-rolled `fetch` call — same behavior, routes through the SDK's typed error handling and retry policy.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @secondlayer/shared@7.0.0
  - @secondlayer/stacks@2.14.1
  - @secondlayer/subgraphs@3.19.7

## 6.29.0

### Minor Changes

- Add `decodeChainWebhook(rawBody)`, a decode/validate helper for chain-subscription webhook deliveries that narrows to the new `ChainWebhookDelivery` type, mirroring `verifyWebhookSignature` beside it (verify the signature, then decode the body). Throws if the body isn't a `chain.*` delivery or if `type` and `data.trigger` disagree, so a future wire-shape drift fails loudly instead of silently mismatching a consumer's hand-rolled parser.

### Patch Changes

- Updated dependencies
  - @secondlayer/shared@6.39.0

## 6.28.2

### Patch Changes

- 91ee6cc: Index sBTC withdrawals list (`/v1/index/sbtc/withdrawals`) now returns settlement detail inline per row — `btc_confirmations`, `btc_block_height`, `confirmed_at` — alongside the existing `settlement_confirmed` flag. Previously only the single-withdrawal detail endpoint carried these, forcing N+1 fetches to render verified BTC-L1 settlement in a list.

## 6.28.1

### Patch Changes

- e0561fb: Collapse the 12 duplicated index `walk*` generators into a shared `keysetWalk` helper. Internal refactor; no behavior or public API change.

## 6.28.0

### Minor Changes

- b9a15b1: Surface BTC L1 settlement on the sBTC withdrawal read API: `/v1/index/sbtc/withdrawals/:request_id` now fills `settlement.{btc_confirmations,settlement_confirmed,btc_block_height,confirmed_at}` from the confirmer instead of nulls, the rolled-up withdrawals list carries a `settlement_confirmed` flag plus a `?settlement_confirmed=` filter, and the SDK types/`settlementConfirmed` param match.

### Patch Changes

- Updated dependencies [c63476a]
- Updated dependencies [236b683]
- Updated dependencies [6e570ea]
- Updated dependencies [69c50cc]
  - @secondlayer/subgraphs@3.17.0
  - @secondlayer/shared@6.38.0

## 6.27.2

### Patch Changes

- c48de2d: refactor(subgraphs): route query builders through canonical buildQuery

## 6.27.1

### Patch Changes

- f78a632: Collapse the duplicated 404→null try/catch in `get*` accessors into a single `BaseClient.requestOrNull` helper (no behavior change).

## 6.27.0

### Minor Changes

- 197b6a8: Add typed `index.sbtc` and `index.pox` accessors for the decoded sBTC peg and PoX reward-cycle surfaces (previously REST-only — callers had to hand-roll `fetch`):

  - `index.sbtc.deposits` (list/walk/get-by-bitcoin-txid), `index.sbtc.withdrawals` (list/walk/get-by-request-id), `index.sbtc.events` (list/walk), `index.sbtc.summary`.
  - `index.pox.cycles` (list/walk/get-by-reward-cycle).

  Exports the response/param types (`IndexSbtcDeposit`, `IndexSbtcWithdrawal`, `IndexSbtcEvent`, `IndexSbtcSummary`, `IndexPoxCycle`, and their envelopes).

## 6.26.1

### Patch Changes

- 3e26837: Route `Subgraphs.gaps`/`delete`/spec query building through the canonical `buildQuery` (now accepts booleans); identical URLs, less duplication.

## 6.26.0

### Minor Changes

- Add `txContext` option to `index.events` `list`/`walk`/`consume`. When set, each event carries its submitting transaction joined in (`tx_sender`, `tx_type`, `tx_status`, `tx_contract_id`, `tx_function_name`), avoiding a `/v1/index/transactions` call per event. For `print` events it's the only source of the submitting sender.

## 6.25.1

### Patch Changes

- Rename the decode plane off the `l2`/`layer2` naming (collides with the blockchain layer model — Bitcoin L1 / Stacks L2).

  - **shared**: DB schema type `l2_decoder_checkpoints` → `decoder_checkpoints` (and `L2DecoderCheckpointsTable` → `DecoderCheckpointsTable`); new migration `0103` renames the table and re-keys checkpoint names `l2.* → decode.*` in place (non-destructive — preserves cursors, no re-decode). Run migrations before booting the decoder. The internal Streams key/tenant defaults change to `sk-sl_streams_decode_internal` / `tenant_streams_decode_internal`.
  - **subgraphs**: streams-index block source falls back to the renamed internal Streams key default.
  - **sdk**: correct the webhook-verify JSDoc — issued signing secrets are bare 64-char hex (not `whsec_`-prefixed); `verifyWebhookSignature` handles both, but a generic Svix/Standard-Webhooks library will mis-base64-decode a bare-hex secret.

  Deploy note: the internal default key changed, so recreate api + decoder + subscription-processor together (a partial rollout 401s the decode reader until consistent).

- Updated dependencies
  - @secondlayer/shared@6.36.0
  - @secondlayer/subgraphs@3.15.2

## 6.25.0

### Minor Changes

- 7efbb8b: Streams response signatures are now verified **by default**. `createStreamsClient`
  (and `sl.streams.events.subscribe`) verify the ed25519 `X-Signature` on REST
  reads and the per-frame SSE signature without opting in. The default is
  _lenient_: the hosted API signs every response so it is verified, while an
  unsigned response from a self-hosted instance with no `STREAMS_SIGNING_PRIVATE_KEY`
  passes through — an _invalid_ signature always throws. Pass `verify: true` (or
  `{ publicKey }` to pin a PEM) for strict mode where a missing signature also
  throws, or `verify: false` to disable. Previously `verify` defaulted to off.

## 6.24.1

### Patch Changes

- 5300168: Fix a reorg off-by-one in the Index and Streams `consume()` loops. On a reorg,
  the consumer rewound to `Cursor.atHeight(forkPoint)`, which returned
  `${forkPoint}:0` — an _exclusive_ cursor, so the fork block's first event
  `(forkPoint, 0)` was never re-read and the new canonical run lost its first row.
  `Cursor.atHeight` now returns the true foot of the height
  (`${forkPoint-1}:<int4-max>`), so the rewind re-reads from `forkPoint:0`
  inclusive. Pairs with the example/docs `onReorg` rollback, which must delete
  `block_height >= fork_point_height` (inclusive of the fork block). Reorg
  envelope docstrings (`IndexReorg`/`StreamsReorg.new_canonical_tip`) corrected:
  it marks the first new-canonical position (`fork:0`, inclusive), not a directly
  resumable exclusive cursor.

## 6.24.0

### Minor Changes

- 1ef678a: `events.replay()` now forwards an optional `onReorg` to its live-tail seam — long-lived replay tails handle reorgs with the same contract as `consume()` (the dump-backfill phase is finalized and never reorgs)

## 6.23.1

### Patch Changes

- 8b7cf33: Fix dumps file downloads 404ing: manifest file paths are bucket-root-absolute while dumpsBaseUrl ends with the dataset prefix — fileUrl now strips the overlap so list() and download() resolve from one base URL (fixes `sl streams pull` and `events.replay` against prod dumps)

## 6.23.0

### Minor Changes

- 258b05e: Index checkpointed consumer: `index.events.consume()` and `index.contractCalls.consume()` — onBatch cursor commit, automatic reorg rewind to the fork point, `finalizedOnly` gated by `tip.finalized_height`, `fromHeight` backfill start; `IndexTip` now carries `finalized_height`

### Patch Changes

- f9c1f2a: README positioning: indexing-first mental model, correct public dumps auth, unified product naming

## 6.22.0

### Minor Changes

- 05b1b12: empirical print-event schema inference: GET /v1/index/contracts/:id/print-schema derives per-topic payload schemas (exact Clarity types from raw_value, presence rates) from indexed history; `sl subgraphs create --from-contract` scaffolds typed defs with prints maps + nullability comments (--table-per-topic for normalized layout); `sl subgraphs codegen --payloads` emits per-topic .d.ts; deploys warn on handler fields never observed for a source's topics; SDK index.printSchema + MCP index_print_schema; prints accepted by filter validation

### Patch Changes

- Updated dependencies [ab8360d]
- Updated dependencies [05b1b12]
  - @secondlayer/subgraphs@3.14.0
  - @secondlayer/shared@6.32.0

## 6.21.2

### Patch Changes

- 5333c43: Remove L1/L2/L3 layer terminology from user-facing descriptions and READMEs (Stacks is itself a Bitcoin L2 — the terms were confusing); describe surfaces as raw (Streams), decoded (Index), and your schema (Subgraphs). Also drop the stale "Foundation Dataset" template wording and refresh the api README Index endpoint list.
- Updated dependencies [db40071]
- Updated dependencies [8ac70d7]
- Updated dependencies [aef3e54]
- Updated dependencies [9ee7879]
  - @secondlayer/shared@6.31.0
  - @secondlayer/subgraphs@3.12.0

## 6.21.1

### Patch Changes

- 2132e2e: Scrub remaining references to the removed Datasets surface from READMEs, templates, and code comments.
- Updated dependencies [2132e2e]
- Updated dependencies [7a9a0d2]
  - @secondlayer/stacks@2.5.1

## 6.21.0

### Minor Changes

- 408e8b7: sl.batch() — up to 10 public /v1 reads in one round trip via POST /v1/batch
- 70004c0: withX402 caches PAYMENT-SESSION vouchers per origin — session-priced surfaces (Streams) settle once per session instead of per call
- 38dad1c: withX402 prepaid credit: balanceToken drawdowns (PAYMENT-BALANCE) and autonomous topUp policy

### Patch Changes

- 6fcd653: Deploy response types include start_block + start_block_clamped
- Updated dependencies [6fcd653]
- Updated dependencies [0449af7]
- Updated dependencies [5dc8fb3]
- Updated dependencies [3def7d4]
- Updated dependencies [38dad1c]
  - @secondlayer/shared@6.30.0
  - @secondlayer/subgraphs@3.11.0

## 6.20.0

### Minor Changes

- f242b9c: Add `streams.consume()` async-iterator yielding page batches (`{ events, cursor, tip, reorgs }`, configurable `intervalMs` tip polling, AbortSignal) and make `index.ftTransfers` / `index.nftTransfers` / `index.events` callable as shorthand for `.list()` (`.list`/`.walk` unchanged).
- cf8c86d: Subgraph visibility + open /v1 read surface. New managed deploys default `public` — anon-readable at `/v1/subgraphs/:name/:table` with the standard cursor envelope (`{ rows, next_cursor, tip }`), wildcard CORS, and anon rate limits; BYO-database deploys default `private` (reads require the owning account's `sk-sl_` key; anon resolution 404s). Public names are a single global namespace claimed on publish (409 `PUBLIC_NAME_TAKEN` on collision). CLI: `sl subgraphs deploy --visibility`, `sl subgraphs publish|unpublish`. SDK: `subgraphs.publish()/unpublish()/rows()`. MCP: `visibility` on `subgraphs_deploy`, new `subgraphs_publish`/`subgraphs_unpublish` tools. Shared: `subgraphs.visibility` column (migration 0092), deploy schema field, `PUBLIC_NAME_TAKEN` error code.
- 54611cd: x402 consumer DX: `withX402(fetch, { account })` drop-in (transparently pays on 402) and `createX402Client({ account, baseUrl })` (`.get/.post` returning `{ data, payment }`). Auto-resolves the payer nonce, selects an offer by `preferAssets` (sBTC-first default) with a `maxAmountPerCall` spend guard (`X402SpendGuardError` when nothing fits), and exposes the settlement receipt via `readX402Receipt`. All re-exported from `@secondlayer/sdk` (no longer subpath-only). See `docs/guides/x402-pay-per-call.md`.
- 2e52a78: Add `@secondlayer/sdk/x402`: a client for the x402 pay-per-request rail. `payAndRetry` runs a request, and on a 402 builds a signed (origin-only, gasless) `PAYMENT-SIGNATURE` from the challenge and retries — one call, no key, no STX. `buildSignedX402Payment`/`readX402Challenge` are exposed for custom flows.

### Patch Changes

- 6c6d2c9: x402 optimistic finality tier (Sprint B): Index/Streams now serve **near-instant** on broadcast-accept (the node admitting the sponsored tx to its mempool), reconciling asynchronously, instead of blocking ~5–29s for canonical confirmation. Gated per-principal by an optimistic gate (`x402/optimistic-gate.ts`) — a fixed-window velocity cap plus a reputation strike counter — that **fails closed** to confirmed-tier; high-value surfaces can stay `confirmed`. `settlePayment` gains a broadcast-no-await mode (`state: "optimistic"`), the catalog carries per-surface `finality` (Index/Streams default optimistic), and the worker reconciler now advances `pending → confirmed | reverted` and records a strike (shared Redis key, `x402StrikeKey`) on revert so repeat droppers lose optimism. Reconciliation confirms against our own indexed `decoded_events` (canonical-gated) — the same substrate the confirmed-tier serve verifies against — so it's self-contained / RPC-free. The SDK's `X402Receipt` now carries the settlement `state` (`optimistic` | `confirmed`).
- Updated dependencies [051bbc5]
- Updated dependencies [0640e37]
- Updated dependencies [49ce0e9]
- Updated dependencies [cf8c86d]
- Updated dependencies [8253e67]
- Updated dependencies [6c6d2c9]
- Updated dependencies [fb7acf4]
- Updated dependencies [8f2de58]
- Updated dependencies [389976a]
- Updated dependencies [2e52a78]
  - @secondlayer/shared@6.29.0
  - @secondlayer/stacks@2.5.0

## 6.19.0

### Minor Changes

- 93cf539: Add a prod-safe single-contract ABI source. New `GET /v1/contracts/:contractId` (registry lookup by id, `?include=abi` for the blob, 404 when absent), SDK `contracts.get(contractId, { includeAbi })`, and a `get_contract_abi` MCP tool. The MCP `scaffold_from_contract` tool now sources ABIs from this registry instead of the OSS/dedicated-only `/api/node/...` proxy (which 404s in prod), so it works in platform/prod.
- 161d558: Add `index.transactions.getProof(txId)` (SDK) and the `index_transaction_proof` MCP tool — fetch a transaction's inclusion proof (raw tx + signed Nakamoto header + merkle path) to verify trustlessly with `verifyTransactionProof`. 404 → null. The proof endpoint now degrades gracefully when the signed-header source (stacks-node) is unreachable: a typed `ProofNodeUnavailableError` → HTTP 503 `PROOF_NODE_UNAVAILABLE` instead of an opaque 500. The api container reads `STACKS_NODE_RPC_URL` (added as a compose env hook, empty by default) — set it to a reachable Nakamoto node to enable proofs in platform/prod.

## 6.18.0

### Minor Changes

- e9c270c: Index discovery + trait filtering for agents. Add `Index.discover()` (GET `/v1/index`) and an `index_discover` MCP tool exposing the live vocabulary — per-event-type columns, allowed/equality filters, and which types accept `trait` — wired into the context resource's discover-first hint. Add a `trait` filter (e.g. `sip-010`) to `index.events` / `index.contractCalls` SDK params and the `index_events` / `index_contract_calls` MCP tools, so `contracts_find → trait → one Index query` composes. (Trait runs through the `/events` and `/contract-calls` routes, which resolve it server-side; the `index_ft_transfers`/`index_nft_transfers` aliases don't take `trait` — use `index_events` with `event_type` for trait-scoped transfers.)
- 9436b6d: Streams discovery for agents. Thread a `dumpsBaseUrl` option through `SecondLayerOptions` → the streams client so `streams.dumps.*` works from the top-level SDK (MCP wires it from `SL_STREAMS_DUMPS_URL`). Add a `streams_dumps` MCP tool exposing the bulk parquet manifest (coverage, `latest_finalized_cursor`, per-file metadata + signed URLs) for cold backfill, and a `secondlayer://streams-filters` resource listing the firehose event types and the filter fields `streams_events`/`streams_consume` accept.
- 4037871: Subscriptions agent parity: expose `authConfig` (bearer receiver auth) on `subscriptions_create`/`subscriptions_update`, `name` (rename) on `subscriptions_update`, and `force` (idempotency suffix to re-run an already-replayed range) on `subscriptions_replay` + the SDK `replay()`. Add `CHAIN_TRIGGER_FIELDS` (derived from `ChainTriggerSchema`, never drifts) in shared and a `secondlayer://chain-triggers` MCP resource listing the filter fields each chain-trigger type accepts.

### Patch Changes

- Updated dependencies [4037871]
- Updated dependencies [fbdd5ae]
  - @secondlayer/shared@6.28.0
  - @secondlayer/stacks@2.4.0

## 6.17.0

### Minor Changes

- cc16ebc: Add `Datasets.get(slug, params)` — a generic reader that resolves any slug against the live `/v1/datasets` catalog and returns a uniform `{ rows, next_cursor, tip }` envelope for cursor and bespoke datasets alike (single-record datasets like `bns/resolve` come back as 0-or-1 rows). Known cursor slugs keep a network-free fast path; the catalog is fetched once and cached. The MCP `datasets_query` tool now routes through `get()`, so every dataset returned by `datasets_list` — including `bns/resolve`, `bns/names`, `bns/namespaces`, `network-health/summary`, and any dataset added later — is queryable, in either family (`sbtc-events`) or path (`sbtc/events`) slug form. `query()` is unchanged (cursor-only).
- 31ad555: Add a `projects` client (`list`/`get`/`create`/`update`/`delete`/`team`) for full project CRUD, and extend `apiKeys` with `list()` (metadata only — never the plaintext) and `revoke(id)` to complete the API-key lifecycle. The `context()` snapshot now includes `projects` and `apiKeys` so agents can see their own inventory before acting.

## 6.16.0

### Minor Changes

- 1c99bd0: Add typed `ByoBreakingChangeError` (exposes `reasons` + rebuild `plan`) thrown on a refused BYO breaking-change deploy (HTTP 422).

### Patch Changes

- Updated dependencies [bbd40f7]
- Updated dependencies [e98f20d]
  - @secondlayer/shared@6.27.0
  - @secondlayer/subgraphs@3.10.0

## 6.15.0

### Minor Changes

- e5684a5: Add `client.aggregate(spec)` to the typed subgraph table client plus the `queryTableAggregate` transport. SUM/MIN/MAX columns are compile-time numeric-only and the result type is inferred from the spec; sum/min/max values are lossless strings, counts are numbers.

### Patch Changes

- Updated dependencies [62e4d90]
- Updated dependencies [f773a6e]
  - @secondlayer/shared@6.26.0
  - @secondlayer/subgraphs@3.9.0

## 6.14.0

### Minor Changes

- 3a7f8a2: Export typed chain-subscription webhook envelopes. `ChainApplyEnvelope`, `ChainReorgRollbackEnvelope`, `ChainReorgOrphanedEntry`, and the `ChainWebhookEnvelope` union are now single-sourced in `@secondlayer/shared` (the subgraphs producer uses them) and re-exported from `@secondlayer/sdk`, so webhook consumers can type the `chain.*.apply` / `chain.reorg.rollback` bodies they receive instead of reading code.
- 2626eb5: Add `client.subscriptions.test(id)` — trigger a logged test delivery for a subscription. Returns `{ ok, statusCode, error, durationMs, deliveryId }`.
- 7ca9bf8: Advertise the seekable retention floor on Streams `/tip` and `/usage`: `oldest_seekable_height` + `oldest_cursor` (the oldest height/cursor the live API serves for the caller's tier; `null` = unlimited). Consumers can now tell how far back the live lane goes before falling to the cold dumps lane. The SDK `StreamsTip` type carries the new optional fields.

### Patch Changes

- Updated dependencies [3a7f8a2]
- Updated dependencies [14657ae]
- Updated dependencies [3a57c08]
- Updated dependencies [af82681]
- Updated dependencies [cb2f803]
- Updated dependencies [321e69c]
- Updated dependencies [abb689c]
- Updated dependencies [4b88e5c]
- Updated dependencies [1b41df2]
- Updated dependencies [6e6026d]
  - @secondlayer/shared@6.25.0
  - @secondlayer/subgraphs@3.8.0

## 6.13.0

### Minor Changes

- c171351: Add trustless transaction-inclusion proofs.

  `@secondlayer/shared/node/nakamoto` parses Nakamoto block headers and recomputes the block_hash, index_block_hash, and tx_merkle_root the chain commits to; `@secondlayer/shared/node/consensus` verifies a header's signer signatures against the reward cycle's signer set. The SDK adds `verifyTransactionProof` (anchored + consensus levels) and `fetchRewardSet`, letting a consumer confirm a transaction's inclusion in a block — and that ≥70% of signer weight attested to that block — without trusting Secondlayer.

### Patch Changes

- Updated dependencies [c171351]
  - @secondlayer/shared@6.24.0

## 6.12.0

### Minor Changes

- 2cb7eff: Type the Index `reorgs[]` field properly. The Index list envelopes (`/transactions`, `/contract-calls`, `/stacking`, and the ft/nft/event feeds) declared `reorgs: never[]`, forcing TS callers to cast even though the API returns real reorg records. They now use a new exported `IndexReorg` type (`{ id, detected_at, fork_point_height, old_index_block_hash, new_index_block_hash, orphaned_range: {from,to}, new_canonical_tip }`) so consumers can read `orphaned_range`/`new_canonical_tip` to reconcile a reorg without a cast.

## 6.11.0

### Minor Changes

- 39f4243: Verify the bulk dumps manifest signature by default. `createStreamsClient` now defaults `verifyDumpsManifest` to `true`, so `client.dumps.list()` (and `events.replay()`, which hydrates from dumps) checks the manifest's ed25519 signature against the published Streams key before trusting any file sha256 — closing the gap where a tampered manifest+file pair verified cleanly. All published manifests are now signed, so this is transparent for consumers pointing at Secondlayer; pass `verifyDumpsManifest: false` to opt out. A missing or invalid signature throws `StreamsSignatureError`.

## 6.10.0

### Minor Changes

- 015e39d: Add opt-in verification of the bulk dumps manifest signature. `createStreamsClient({ verifyDumpsManifest: true })` makes `client.dumps.list()` check the manifest's ed25519 signature against the published Streams key before any file sha256 is trusted — a sha256 is only as trustworthy as the manifest that carries it. It reuses the same key source as the live-response `verify` option (pinned PEM or `/public/streams/signing-key`). Defaults off so existing consumers are unaffected until historical manifests have been backfilled with signatures; an unsigned or tampered manifest throws `StreamsSignatureError` when enabled.
- 189e379: Add `client.events.subscribe(...)` for the real-time Streams SSE push surface. It calls `onEvent` for each new canonical event as the server pushes it — chain cadence rather than the long-poll's 500ms empty backoff — and returns an unsubscribe function. Unlike a browser `EventSource` it uses a fetch-based reader so it can send the mandatory `Authorization` header (Streams is key-mandatory) and an `AbortSignal`; it reconnects from the last delivered cursor on a dropped connection. When the client was created with `verify`, each frame's inline ed25519 signature is checked before the event is delivered.
- 61ef1d4: Sign every subscription webhook with a universal ed25519 signature, regardless of body format. Previously only the `standard-webhooks` format carried an HMAC; `raw`, `cloudevents`, `trigger`, `cloudflare`, and `inngest` deliveries carried no Secondlayer proof, so a receiver had no way to verify a payload came from us. Each delivery now also gets `webhook-id` + `X-Secondlayer-Signature` (ed25519 over `${webhook-id}.${body}`) + `X-Secondlayer-Signature-KeyId`, signed with a single platform key (`SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY`, falling back to the existing `STREAMS_SIGNING_PRIVATE_KEY`). Body shapes stay format-specific. Receivers verify with the new `verifySecondlayerSignature(rawBody, headers, publicKeyPem)` SDK helper against the published public key — no per-subscription secret. Signing is a no-op when no key is configured, so it is safe to ship before the key is provisioned. Also publishes `@secondlayer/shared/crypto/ed25519` as an importable subpath.

### Patch Changes

- 0424f52: Add `reorgs[]` to the Index `/v1/index/stacking` response so a client tracking stacking actions gets the same height-granular reorg reconciliation signal as `/contract-calls` and `/transactions`. `getStackingResponse` now reads `readChainReorgsForHeightRange` over the returned block-height range (over-inclusive, never under-reports; skipped on an empty page), and the SDK `StackingEnvelope` carries the matching `reorgs` field.
- Updated dependencies [5b7fccf]
- Updated dependencies [fd8503b]
- Updated dependencies [958c883]
- Updated dependencies [b044f39]
- Updated dependencies [434c947]
- Updated dependencies [eccd246]
- Updated dependencies [250e910]
- Updated dependencies [f1706c0]
- Updated dependencies [61ef1d4]
  - @secondlayer/subgraphs@3.7.3
  - @secondlayer/shared@6.23.0

## 6.9.1

### Patch Changes

- 33bba4d: Document the API-key product/scope model in the package READMEs: an `account` key is the owner credential (reads Streams + Index, and is the only key that can mint), while `streams`/`index` keys are scoped reads that cannot mint. Adds the key-mint paths — `sl.apiKeys.create()`, `sl keys create`, and the `account_create_key` MCP tool.

## 6.9.0

### Minor Changes

- a777de7: Add an agent orientation snapshot available to every surface, not just MCP. `SecondLayer.context()` (SDK) assembles, concurrently and degrading to `null` per field, the account, live Streams + Index tips, your subgraphs/subscriptions (with a per-status breakdown), and any in-flight reindex operations. The MCP `secondlayer://context` resource now builds on this — so it gains the tips, subscription health, and in-flight operations it lacked — and `sl context` (CLI) prints the same snapshot so non-MCP agents aren't context-starved.
- e0f9499: Agent-reachable, hardened API-key mint. A headless agent holding an account-level (owner) key can now self-provision a SCOPED `streams`/`index` read key via `POST /v1/api-keys` — no dashboard. The minted key is always scoped (never an account/superkey), inherits the account plan's tier, is per-IP rate limited, and is bounded by a per-account active-key ceiling. Surfaced as `sl.apiKeys.create()` (SDK), `sl keys create` (CLI), and the `account_create_key` MCP tool.

  Also closes a privilege-escalation hole on the existing `POST /api/keys`: it accepted any valid credential and did no product check, so a leaked scoped key could mint an account superkey. Minting is now owner-gated (a dashboard session or an `account`-product key), and non-session callers are confined to scoped keys with an inherited tier.

- a9be0a3: Let an agent read its own consumption and limits. `GET /v1/streams/usage` and `GET /v1/index/usage` return the account's events today + this month for that product plus its tier limits (Streams: rate limit + retention days; Index: rate limit), reusing the existing metering. Streams is key-mandatory; Index requires a Build+ key (anonymous → 401). Surfaced as `sl.streams.usage()` / `sl.index.usage()` (SDK) and the `streams_usage` / `index_usage` MCP tools, and listed in the `/v1/streams` and `/v1/index` discovery routes.
- 22725d0: Expose subgraph operation status so agents can poll a reindex/backfill to completion instead of guessing. `reindex`/`backfill`/`stop` already return an `operationId`; now `GET /api/subgraphs/:name/operations/:id` returns that operation's live status (kind, status, processed blocks, a derived 0–1 progress, error, timestamps), and `GET /api/subgraphs/:name/operations` lists recent operations. Surfaced as `sl.subgraphs.getOperation(name, id)` / `sl.subgraphs.operations(name)` (SDK) and the `subgraphs_operation` MCP tool. Backed by the existing `subgraph_operations` table — no migration.

### Patch Changes

- 80433eb: Consolidate the decoded event-type vocabulary into a single `@secondlayer/shared` source (`DECODED_EVENT_TYPES`, `STREAMS_EVENT_TYPES`, and the now-exported `CHAIN_TRIGGER_TYPES`), replacing the duplicate literal copies in the SDK, indexer, and MCP tools. The MCP context resource now generates its `whatYouCanDo` capability list from the live tool registry, so it can no longer drift behind the actual tool surface.
- Updated dependencies [80433eb]
- Updated dependencies [22725d0]
  - @secondlayer/shared@6.18.0

## 6.8.0

### Minor Changes

- bb96d3f: feat: `trigger.*` chain-subscription builders + MCP chain support

  Expose ergonomic chain-trigger builders for direct chain-level subscriptions from the SDK root, and let the MCP `subscriptions_create` tool create chain subscriptions.

  - SDK now exports `trigger` (`import { trigger } from "@secondlayer/sdk"`) with one builder per event type (`trigger.contractCall`, `trigger.ftTransfer`, …), plus the `ChainTrigger` / `SubscriptionKind` types. Use as `subscriptions.create({ triggers: [trigger.contractCall({ ... })] })`. Raw `triggers` objects still work. (Renamed from the previously-unreachable `on` export to avoid colliding with `@secondlayer/stacks`'s subgraph-source `on`.)
  - MCP `subscriptions_create` accepts a `triggers` array (chain subscription) as an alternative to `subgraphName`/`tableName` (subgraph subscription).

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.17.0

## 6.7.0

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
  - @secondlayer/subgraphs@3.7.0

## 6.6.0

### Minor Changes

- 30033cf: Expose raw hex `function_args_hex` on `/v1/index/transactions` (the `contract_call` sub-object) alongside the decoded `function_args`, for consumers that decode ClarityValues themselves (`decode(function_args_hex[i]) === function_args[i]`). Used by the subgraph runtime's Index source to reconstruct contract_call transactions identically to the DB tap.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.15.0
  - @secondlayer/subgraphs@3.6.0

## 6.5.0

### Minor Changes

- 65b7839: Add a `contract_id` filter to `/v1/index/mempool` (and `sl.index.mempool.list/walk({ contractId })`) — watch pending calls to a single contract in one query, for keepers and agent feeds.

## 6.4.0

### Minor Changes

- 4b96a8a: Add mempool (pending transactions) to the Index API.

  The indexer now persists unconfirmed transactions from the Stacks node's `/new_mempool_tx` observer callback (deriving the txid from raw_tx), evicts them on confirmation (block ingest) or drop (`/drop_mempool_tx`), and sweeps stuck rows. The Index API serves them at `GET /v1/index/mempool` (filter by `sender`/`type`, cursor-paginated) and `GET /v1/index/mempool/:tx_id` — full pending-transaction documents (fee/nonce/post-conditions decoded from raw_tx), minus the block-anchored fields, plus `received_at`. Mempool reads are never cacheable (volatile). New SDK client: `index.mempool` (`list`/`walk`/`get`).

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.14.0

## 6.3.0

### Minor Changes

- 6088df9: Expand the Index API with canonical block-hash map, blocks, full transaction documents, and PoX-4 stacking, plus finality-gated HTTP caching across all Index reads.

  New endpoints: `GET /v1/index/canonical`, `/v1/index/blocks` (+ `/:height_or_hash`), `/v1/index/transactions` (+ `/:tx_id`, full documents with fee/nonce/post-conditions decoded from `raw_tx`), and `/v1/index/stacking`. All Index responses now carry `Cache-Control` and ETag/304 for finalized ranges. New SDK clients: `index.canonical`, `index.blocks`, `index.transactions`, and `index.stacking` (each with `list`/`walk`, and `get` for blocks/transactions).

## 6.2.1

### Patch Changes

- 43325d9: Sync package READMEs with the newly added surfaces: SDK datasets/contracts root clients, MCP datasets/index/streams/contracts tools + `secondlayer://context` resource + account update/billing, and CLI `sl index` / `projects delete` / data-products read commands.

## 6.2.0

### Minor Changes

- 78c6fd4: Expose `datasets` and `contracts` clients on the `SecondLayer` root client. `sl.datasets` reaches the Foundation Datasets API (including the `listDatasets()` catalog), and the new `sl.contracts.list({ trait })` wraps `/v1/contracts` for trait-based contract discovery.

## 6.1.0

### Minor Changes

- 727e130: `events.consume()` now owns reorg handling and checkpoint computation. New `onReorg(reorg, { cursor })` callback fires once per deduped reorg — roll your projection back to `reorg.fork_point_height` and the SDK rewinds the cursor and re-reads the now-canonical events (the re-reported-reorg loop and fork-point math are handled internally). New `finalizedOnly` flag emits only immutable events and never surfaces reorgs. `onBatch` gains a third `ctx` arg carrying the checkpoint cursor to persist (the last finalized event in `finalizedOnly` mode, else `next_cursor`). Exposes a `Cursor` helper (`atHeight`, `parse`) and documents `event.cursor` as the projection primary key. All additions are optional and back-compatible; the return-a-cursor path is unchanged.

### Patch Changes

- 5603d5a: Index and Streams clients build query strings through one canonical `buildQuery` helper instead of three copy-pasted append helpers; fixes a dangling `?` on `/v1/index/events` when called with no filters.
- 63e7e6c: Validate stream cursors when parsing. A malformed `from` cursor passed to `events.replay()` previously parsed to `NaN` and silently dropped all dump files / mis-seamed the live tail; it now throws `ValidationError`.
- eb7dc43: Streams ft/nft transfer decoders reuse the shared `_payload` helpers instead of inlining their own copies; decoded output and error messages are unchanged.
- Updated dependencies:
  - @secondlayer/shared@6.13.0

## 6.0.0

### Major Changes

- 5fcd621: `StreamsEvent` is now a discriminated union keyed on `event_type`, so `event.payload` narrows to a typed per-type shape (e.g. `FtTransferPayload`, `PrintPayload`) once the type is checked — no manual casting or guard call needed.

  BREAKING: `payload` is no longer `Record<string, unknown>`, and `StreamsEventPayload` is now the union of the per-type payloads. Code that read arbitrary keys off `event.payload` without first narrowing on `event_type` (or using a guard like `isFtTransfer`) will now fail to type-check. Narrow on `event_type`, use the `isX`/`decodeX` helpers, or cast untyped wire data to the specific payload type.

### Minor Changes

- 655db50: Add exclusion and multi-value filters to the Streams events firehose. `not_types` excludes event types, and `contract_id`, `sender`, and `recipient` now accept comma-separated lists (matching any value). Exposed on `GET /v1/streams/events`, the SDK (`events.list/consume/stream` accept `notTypes` and `string | string[]` filters), and the `sl streams events`/`consume` CLI (`--not-types`, `--sender`, `--recipient`, comma lists on `--contract-id`).

  No new indexes: `not_types` narrows the existing `type IN (...)` set and the list filters reuse the same range-bounded `events.data` access path as the single-value filters, so the query plan is unchanged.

- 5fcd621: Streams `verify` now survives a signing-key rotation. The client caches the key id alongside the public key and compares it against the `X-Signature-KeyId` response header; when the server rotates, a fetched key is refreshed once and re-verified, while a pinned key fails closed on a mismatch. Previously the public key was cached for the client's lifetime, so verification broke until the process restarted.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.12.0

## 5.9.0

### Minor Changes

- 06e4810: `createStreamsClient` gains a `dumps` namespace (set `dumpsBaseUrl` to the public bulk bucket): `dumps.list()` fetches the parquet manifest, `dumps.fileUrl(file)` resolves a file's URL, and `dumps.download(file)` fetches a parquet and verifies its sha256 against the manifest. Backs "download all the raw data" bulk backfill.
- 3cea0d5: Streams types expose finality: `StreamsEvent.finalized?` and `StreamsTip.finalized_height?` reflect the new fields the API returns, so consumers can tell which events are past the burn-confirmation finality boundary (immutable).
- bedeb1d: Add `events.replay({ from, onDumpFile, onBatch })`: backfill from bulk dumps then continue live in one call. It iterates finalized dump files in block order (you process the parquet with your own tooling via `onDumpFile`), then tails live from the manifest's `latest_finalized_cursor` — exclusive input, so there's no gap or duplicate at the dump→live seam.
- 9ee756c: `createStreamsClient` gains an optional `verify` hook (default off): pass `true` to fetch the server's ed25519 public key, or `{ publicKey }` to pin one. When enabled, every response's `X-Signature` is verified over the raw body and a mismatch/missing signature throws the new `StreamsSignatureError`.
- 48a8b08: Streams events now support `sender`, `recipient`, and `asset_identifier` filters on `/v1/streams/events` (and the SDK `events.list`/`consume`/`stream`), matching Index's principal/asset filters. They apply as exact-match predicates on the raw event payload, so event types lacking the field simply don't match — the firehose narrows naturally. Closes the query-parity gap with Index.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.11.0

## 5.8.0

### Minor Changes

- 501e095: Add realtime subgraph row streaming over Server-Sent Events. A new endpoint `GET /api/subgraphs/<name>/<table>/stream` pushes rows as they're indexed (go-forward by default, `?since=<block>` to replay then tail), accepting the same column filters as the list endpoint. The SDK's typed client gains `subgraph.<table>.subscribe(onRow, { where, since })`, which opens the stream and returns an unsubscribe function — a browser-friendly way to react to indexed data live without running a webhook receiver.

### Patch Changes

- Updated dependencies:
  - @secondlayer/subgraphs@3.5.0

## 5.7.0

### Minor Changes

- 96fd583: Add the burnchain rewards dataset: Bitcoin PoX reward payouts and reward-set membership, indexed from the stacks-node `/new_burn_block` event. Served at `/v1/datasets/burnchain/rewards` (filter by `recipient`) and `/v1/datasets/burnchain/reward-slots` (filter by `holder`), cursor-paginated by burn block height. New SDK clients `datasets.burnchainRewards` and `datasets.burnchainRewardSlots` (list/walk), and `sl datasets query burnchain-rewards`. Go-forward only.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.10.0

## 5.6.0

### Minor Changes

- ae8b749: Add a typed Datasets client and `sl datasets` CLI command for the Foundation Datasets (`/v1/datasets/*`) — previously HTTP-only. The SDK `Datasets` client offers uniform `list`/`walk` (cursor) for the event datasets (sBTC, BNS, PoX-4, STX transfers) plus bespoke methods for BNS names/namespaces/resolve and network-health. `sl datasets list` / `sl datasets query <dataset> --filter k=v` query from the terminal. Adds an `address` super-filter to the pox-4 calls dataset that matches a stacker's activity across any role (caller, stacker, or delegate_to).
- 948c0d5: Add `in`/`notIn`/`like` filter operators and deterministic multi-column ordering to the subgraph query client. `findMany`/`count` now accept `{ col: { in: [...] }, name: { like: "a%" } }` and `orderBy: [["blockHeight","desc"],["id","asc"]]`. All values are parameterized server-side (`IN ($1,$2,…)`); `in`/`notIn` are comma-encoded over REST so values cannot contain commas.

### Patch Changes

- Updated dependencies:
  - @secondlayer/subgraphs@3.4.0

## 5.5.0

### Minor Changes

- 4657c71: Index now serves `stx_lock` (stacking lock) events via `GET /v1/index/events?event_type=stx_lock`. The locked principal maps to `sender`, the locked uSTX to `amount`, and `unlock_height` rides in `payload` (`{ unlock_height }`) — filterable by `sender`. SDK adds `decodeStxLock` / `isStxLock` + `DecodedStxLock` types and the `IndexStxLock` client variant. No migration: reuses the existing `decoded_events.payload` jsonb column.

## 5.4.0

### Minor Changes

- d2358b1: `Index` client gains `events.list/walk` — generic decoded events keyed by `event_type`, returning a discriminated `IndexEvent` union (transfers, mints, burns, and `print`) — and `contractCalls.list/walk` for decoded contract-call transactions, alongside the existing `ftTransfers`/`nftTransfers`. Cursors are opaque and per-endpoint (events use `block_height:event_index`, contract-calls use `block_height:tx_index`).

## 5.3.0

### Minor Changes

- 8557963: Index now serves decoded contract-call transactions. `GET /v1/index/contract-calls` returns each `contract_call` tx with its decoded `function_name`, positional `args` (Clarity values decoded to JSON), `result`, and `result_hex` — filterable by `contract_id`, `function_name`, and `sender`, cursor-paginated on `<block_height>:<tx_index>`. Sourced from the transactions table (canonical via block height); always returns `reorgs: []`.

  SDK exports `decodeClarityValue` / `toJsonSafe` (a hex-Clarity-value → JSON-safe decoder, now shared by the print decoder and reusable by callers).

## 5.2.0

### Minor Changes

- 81fc2d8: Index now decodes and serves Clarity `print` events. `GET /v1/index/events?event_type=print` returns each print's `topic`, the Clarity `value` decoded to JSON (uints as strings, buffers as `0x…` hex, tuples as objects), and the canonical `raw_value` hex — filterable by `contract_id`.

  SDK adds `decodePrint` / `isPrint` and the `DecodedPrint` types (depends on `@secondlayer/stacks` for Clarity decoding). A nullable `payload` JSONB column is added to `decoded_events` to hold decoded values that don't fit the flat transfer columns. The indexer runs a `print` decoder; the API registry and OpenAPI expose it.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.8.0

## 5.1.0

### Minor Changes

- 239e2f2: Index now decodes and serves STX transfers, mints, and burns for tokens. `GET /v1/index/events` accepts `event_type` of `stx_transfer`, `stx_mint`, `stx_burn`, `ft_mint`, `ft_burn`, `nft_mint`, and `nft_burn` alongside the existing transfer types.

  SDK adds `decodeStxTransfer`, `decodeStxMint`, `decodeStxBurn`, `decodeFtMint`, `decodeFtBurn`, `decodeNftMint`, `decodeNftBurn` (plus their decoded types, `is*` guards, and the `DecodedEventColumns` helper) and widens `DecodedEventRow` to the full set. The indexer runs a decoder per new type; the API registry and OpenAPI expose them with per-type filters.

## 5.0.0

### Major Changes

- b0035b2: Rename streams `index_block_hash` to `block_hash` on `StreamsEvent`, `StreamsTip`, and `StreamsCanonicalBlock`. The field always carried the block header hash (matching Hiro's `hash`), not the Stacks index block hash.

## 4.0.2

### Patch Changes

- 229c297: Add license, repository, and homepage metadata plus a bundled LICENSE file; drop src from clarity-docs npm files.
- Updated dependencies:
  - @secondlayer/shared@6.4.5
  - @secondlayer/subgraphs@3.2.1

## 4.0.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/subgraphs@3.0.0

## 4.0.0

### Major Changes

- 71e80cd: fix(sdk): verifyWebhookSignature now validates the real Standard Webhooks delivery format

  The previous implementation validated a Stripe-style `x-secondlayer-signature` header that no Secondlayer delivery format actually emits — so it returned `false` for every real webhook. The signature has changed:

  ```ts
  // before — validated nothing in production
  verifyWebhookSignature(rawBody, signatureHeader: string, secret, toleranceSeconds?)

  // after — validates `standard-webhooks` (the default format)
  verifyWebhookSignature(rawBody, headers, secret, toleranceSeconds?)
  ```

  `headers` accepts a plain object (Express `req.headers`), a Fetch `Headers` instance (Hono / Bun / Workers), or a callback `(name) => value`. Header lookup is case-insensitive.

  Also exports `StandardWebhooksHeaders` and `verifyStandardWebhooksHeaders` (the lower-level helper from `@secondlayer/shared/crypto/standard-webhooks`) for advanced cases.

## 3.6.1

### Patch Changes

- faa0c64: `BaseClient` now serializes BigInt values in request bodies to strings (via a JSON.stringify replacer) and surfaces body-encoding failures with a clear error message instead of masking them as "Cannot reach API". Fixes `sl subgraphs deploy` silently failing on configs that use bigint literals (e.g. `minAmount: 1_000_000n` in an `stx_transfer` filter).

## 3.6.0

### Minor Changes

- e9e50d7: Drop tenant URL auto-resolution and ephemeral JWT minting. Subgraphs and subscriptions now route through the platform API alongside Streams and Index — pass your `sk-sl_*` key as `apiKey` and the SDK uses it directly. Removed: `tenantBaseUrl` constructor option, `requestAtTenant`/`requestTextAtTenant`, `getTenantSession`, `getTenantBaseUrl`, `mintTenantSession`, `MintEphemeralResponse`/`TenantSession` types.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.3.4

## 3.5.4

### Patch Changes

- fc9fbc0: fix subgraphs + subscriptions returning "Malformed JWT" 401 on tenant URLs. SDK 3.5.3's auto-resolve landed on the right tenant URL but kept sending the platform `sk-sl_*` key as Bearer — tenant containers expect a short-lived HS256 JWT. SDK now mints an ephemeral JWT via `POST /api/tenants/me/keys/mint-ephemeral` on first tenant call (which returns both `apiUrl` + `serviceKey` in one round-trip, replacing the previous `/api/tenants/me` resolver), caches the session, and refreshes 30 s before the 5-min TTL expires. `tenantBaseUrl` constructor option still bypasses the mint flow for OSS / staging setups where the same `apiKey` works against both surfaces.

## 3.5.3

### Patch Changes

- 34c7d2e: auto-resolve tenant baseUrl for subgraphs + subscriptions; expose `ApiError.code`. previously `sl.subgraphs.list()` and `sl.subscriptions.list()` 404'd on the documented default `baseUrl` because those routes don't run on the platform api — they live on per-tenant containers. the SDK now lazily resolves the tenant url via `/api/tenants/me` on first tenant-resource call, caches it, and routes requests there. opt-out via `tenantBaseUrl` constructor option (OSS / staging / custom routing). `ApiError` gains a `code` field populated from the api's `{error, code}` envelope so callers don't have to dig into `err.body` for `VALIDATION_ERROR`, `NOT_FOUND`, etc. distinctive codes for tenant resolution failures: `TENANT_SUSPENDED`, `NO_TENANT`.

## 3.5.2

### Patch Changes

- 57a1472: fix `decodeNftTransfer` reading wrong payload field. live streams emits the token id as a typed Clarity value at `payload.value` (e.g. `{UInt: 52}`) and the canonical hex at `payload.raw_value`. the decoder was reading `payload.value` and throwing on every event, leaving `decoded_events` empty for `nft_transfer`. now prefers `raw_value`, mirroring the indexer 1.3.7 sbtc/bns fix.

## 3.5.1

### Patch Changes

- 3c53cb4: fix(streams): pipe contractId through events.consume / events.stream

  The streams events consumer had no way to push a server-side `contract_id` filter into the events fetch — only `types` was forwarded. On a backfill from a stale checkpoint that translates to "scan every print event in the cursor range across every contract," which on mainnet hit socket-close timeouts and stalled the BNS decoder. SDK `events.consume` / `events.stream` now accept `contractId` and forward it to the API; the BNS decoder uses it for the BNS-V2 mainnet contract.

## 3.5.0

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.1.0

## 3.4.0

### Minor Changes

- 8e80efe: Add bounded Streams iterator controls for page limits, empty-poll limits, and bounded consumption mode.

## 3.3.2

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@6.0.0
  - @secondlayer/subgraphs@2.0.0

## 3.3.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@5.0.0
  - @secondlayer/subgraphs@1.3.3

## 3.3.0

### Minor Changes

- f8645e8: Add generated subgraph API specs for OpenAPI, compact agent schemas, and Markdown docs across shared, SDK, CLI, and MCP surfaces.

### Patch Changes

- Updated dependencies:
  - @secondlayer/shared@4.4.0

## 3.2.2

### Patch Changes

- 1a3a80d: Harden tenant runtime environment injection, subgraph operation cleanup, subscription scoping, and destructive CLI error handling.
- Updated dependencies [1a3a80d]
  - @secondlayer/subgraphs@1.3.2
  - @secondlayer/shared@4.3.3

## 3.2.1

### Patch Changes

- Add optional subgraph operation fields to reindex, backfill, deploy, and stop response typings.

- Updated dependencies []:
  - @secondlayer/shared@4.3.0
  - @secondlayer/subgraphs@1.3.0

## 3.2.0

### Minor Changes

- Add CLI bearer-token subscription auth, deploy-time subgraph startBlock overrides, and MCP deploy startBlock support.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@4.2.0

## 3.1.0

### Minor Changes

- Add the agent-native subscription golden path: shared subscription schemas, schema-aware API and CLI validation, first-class `sl subscriptions` lifecycle commands, MCP lifecycle parity, and updated subscription docs.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@4.1.0

## 3.0.1

### Patch Changes

- Minor error-message nits and README updates.

- Updated dependencies []:
  - @secondlayer/shared@4.0.0
  - @secondlayer/subgraphs@1.1.0

## 3.0.0

### Major Changes

- [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop `sl.sentries` client; subgraphs-only surface. Workflows and sentries packages removed from the repo.

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

- [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Replay + DLQ + MCP subscription tools.

  - `@secondlayer/subgraphs`: new `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` re-enqueues historical rows as outbox entries marked `is_replay=TRUE`. Emitter claims batches 90/10 live vs replay so replays never starve live deliveries.
  - `@secondlayer/sdk`: `sl.subscriptions.replay(id, range)`, `recentDeliveries(id)`, `dead(id)`, `requeueDead(id, outboxId)`.
  - `@secondlayer/mcp`: 7 new subscription tools — `subscriptions_list|get|create|update|delete|replay|recent_deliveries`. Restart MCP clients after upgrade so the tool cache refreshes.
  - Dashboard subscription detail: replay dialog (block range prompt) + DLQ tab listing dead rows with one-click requeue.
  - API: `POST /api/subscriptions/:id/replay`, `GET .../dead`, `POST .../dead/:outboxId/requeue`.

- [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Subscriptions CRUD surface — new `sl.subscriptions.*` client plus the DB schema + query helpers that back it.

  - SDK: `sl.subscriptions.create/list/get/update/delete/rotateSecret/pause/resume` with `CreateSubscriptionResponse` returning a one-time `signingSecret`.
  - Shared: Migration `0057_subscriptions` creates `subscriptions` + `subscription_outbox` + `subscription_deliveries` with the `subscriptions:new_outbox` notify trigger. Kysely types for all three tables. New `standard-webhooks` signing helper (matches Svix reference vectors). Subscription queries with encrypted signing secrets (reuses `crypto/secrets`).
  - OSS bootstrap: `SECONDLAYER_SECRETS_KEY` autogenerates to `.env.local` on first use when `INSTANCE_MODE=oss`.

  No delivery yet — the emitter worker + outbox draining lands Sprint 3. Platform-mode mirror table deferred to a follow-up.

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8), [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64)]:
  - @secondlayer/shared@3.0.0
  - @secondlayer/subgraphs@1.0.0

## 3.0.0-beta.2

### Minor Changes

- Replay + DLQ + MCP subscription tools.

  - `@secondlayer/subgraphs`: new `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` re-enqueues historical rows as outbox entries marked `is_replay=TRUE`. Emitter claims batches 90/10 live vs replay so replays never starve live deliveries.
  - `@secondlayer/sdk`: `sl.subscriptions.replay(id, range)`, `recentDeliveries(id)`, `dead(id)`, `requeueDead(id, outboxId)`.
  - `@secondlayer/mcp`: 7 new subscription tools — `subscriptions_list|get|create|update|delete|replay|recent_deliveries`. Restart MCP clients after upgrade so the tool cache refreshes.
  - Dashboard subscription detail: replay dialog (block range prompt) + DLQ tab listing dead rows with one-click requeue.
  - API: `POST /api/subscriptions/:id/replay`, `GET .../dead`, `POST .../dead/:outboxId/requeue`.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@1.0.0-beta.3

## 3.0.0-beta.1

### Minor Changes

- Subscriptions CRUD surface — new `sl.subscriptions.*` client plus the DB schema + query helpers that back it.

  - SDK: `sl.subscriptions.create/list/get/update/delete/rotateSecret/pause/resume` with `CreateSubscriptionResponse` returning a one-time `signingSecret`.
  - Shared: Migration `0057_subscriptions` creates `subscriptions` + `subscription_outbox` + `subscription_deliveries` with the `subscriptions:new_outbox` notify trigger. Kysely types for all three tables. New `standard-webhooks` signing helper (matches Svix reference vectors). Subscription queries with encrypted signing secrets (reuses `crypto/secrets`).
  - OSS bootstrap: `SECONDLAYER_SECRETS_KEY` autogenerates to `.env.local` on first use when `INSTANCE_MODE=oss`.

  No delivery yet — the emitter worker + outbox draining lands Sprint 3. Platform-mode mirror table deferred to a follow-up.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@3.0.0-beta.1

## 3.0.0-alpha.0

### Major Changes

- Drop `sl.sentries` client; subgraphs-only surface. Workflows and sentries packages removed from the repo.

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2)]:
  - @secondlayer/shared@3.0.0-alpha.0
  - @secondlayer/subgraphs@1.0.0-alpha.0

## 2.0.0

### Major Changes

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

## 1.0.1

### Patch Changes

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0
  - @secondlayer/subgraphs@0.11.8

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

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.
  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.
- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f)]:
  - @secondlayer/shared@1.0.0
  - @secondlayer/workflows@1.0.0
  - @secondlayer/subgraphs@0.11.6

## 0.10.3

### Patch Changes

- Add verifyWebhookSignature helper for verifying x-secondlayer-signature HMAC headers on webhook deliveries

## 0.10.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.11.0
  - @secondlayer/shared@0.12.0
  - @secondlayer/workflows@0.0.3

## 0.10.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0
  - @secondlayer/subgraphs@0.10.0
  - @secondlayer/workflows@0.0.2

## 0.10.0

### Minor Changes

- feat: add workflows support across packages

  - @secondlayer/sdk: add workflows client
  - @secondlayer/cli: add `sl workflows` commands
  - @secondlayer/mcp: add workflow tools for AI agents
  - @secondlayer/indexer: add tx repair script for missing function_args and raw_result

## 0.9.1

### Patch Changes

- Updated dependencies [885662d]
  - @secondlayer/subgraphs@0.9.0
  - @secondlayer/shared@0.10.1

## 0.9.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0
  - @secondlayer/subgraphs@0.8.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0
  - @secondlayer/subgraphs@0.7.2

## 0.8.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0
  - @secondlayer/subgraphs@0.7.0

## 0.7.0

### Minor Changes

- Add `subgraphs.backfill()` SDK method and `sl subgraphs backfill` CLI command for non-destructive block range re-processing.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.6.0
  - @secondlayer/shared@0.7.1

## 0.6.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0
  - @secondlayer/subgraphs@0.5.7

## 0.6.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/subgraphs@0.5.6

## 0.6.2

### Patch Changes

- fix(subgraphs): fix Zod v4 type cast in validate.ts
  chore(sdk): remove dangling ./contracts export
- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.3

## 0.6.1

### Patch Changes

- Fix subgraph queryTable to unwrap `data` field from API response.

## 0.6.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0
  - @secondlayer/subgraphs@0.5.0

## 0.5.0

### Minor Changes

- Add SDK README with comprehensive examples. Fix error serialization for non-string bodies. Validate orderBy accepts only single column. Handle limit=0 correctly in listDeliveries. Remove Contracts client in favor of views system.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/views@0.3.0

## 0.4.1

### Patch Changes

- Updated dependencies [48e42ba]
  - @secondlayer/shared@0.3.0
  - @secondlayer/views@0.2.4

## 0.4.0

### Minor Changes

- Add `getView()` standalone factory to `@secondlayer/sdk`. Mirrors `getContract()` — accepts a view def + plain options, `SecondLayer`, or `Views` instance; no `SecondLayer` instantiation required for view-only use cases.

  Generated `createClient` from `sl views generate` now takes `options?: { apiKey?: string; baseUrl?: string }` instead of `sl: SecondLayer`.

## 0.3.1

### Patch Changes

- Fix API base URL (secondlayer.io → secondlayer.tools)

## 0.3.0

### Minor Changes

- Restructure SDK into subpath exports (`@secondlayer/sdk/streams`, `@secondlayer/sdk/views`). Replace `StreamsClient` with `SecondLayer` class composing `Streams` and `Views` domain clients. Extract `BaseClient` abstract with shared request/auth logic. Default baseUrl to `https://api.secondlayer.io`.

## 0.2.0

### Minor Changes

- Add @secondlayer/sdk - TypeScript client for SecondLayer API with stream management, view queries, and queue stats

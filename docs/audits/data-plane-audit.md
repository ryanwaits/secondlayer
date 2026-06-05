# Secondlayer Stacks Data Plane — Microservice Audit

> Audience: founder/architect. Scope: how well the Secondlayer data plane realizes the microservice decomposition the reference data-plane model (Fungible Systems / aulneau) proposed for Stacks indexing.

## 1. Executive Verdict

Secondlayer realizes the reference model's vision *more completely than the reference model ever shipped* — it has the two-microservice capture/transform split, plus a third layer (Subgraphs) that delivers the reference model's The-Graph aspiration, an ORM-like typed client, ABI scaffolding, and agent-native (MCP) authoring. The seams that matter (l2-decoder→api over HTTP, PublicApiBlockSource for L3) exist and are the right cut points. But the decomposition is **process boundaries, not data boundaries**: one shared Postgres is the integration bus, and the public read edges reach straight into the indexer's own write tables with no schema contract — so a producer-side column change silently breaks the API. Net: a strong "monolith of services" that is one disciplined step (the dormant dual-DB + the HTTP read seam) away from the reference model-grade service isolation.

## 2. Scorecard

| the reference model dimension | Verdict | Why (one line) |
|---|---|---|
| separation-of-capture | partial | Capture/decode are distinct processes over an HTTP seam, but share one Postgres + image; pox-4 taps the raw `transactions` table directly. |
| data-availability-decoupling | aligned | Node-free sync fully achieved: cursor HTTP API + resumable SDK consumer + parquet dumps; live responses ed25519-signed (exceeds the reference model's "future" proofs). |
| canonical-only-sync | aligned | Two canonical surfaces wired; `/v1/index/canonical` is the PR#1166 map; SDK self-heals by height-rewind without full replay. |
| transformation-domain-objects | partial | Confirmed tx, mempool, FT/NFT/STX/stacking events, canonical map all present; microblocks/attachments absent (defensible); stacking off-by-default + DB-tapped. |
| tooling-custom-views | aligned | Most complete dimension: typed DSL, trait/contract/function filters, ABI scaffold, typed query client, MCP authoring. |
| service-boundaries-coupling | partial | Real process split + correct seams, but shared-DB-as-contract dominates; rate-limit process-local; dual-DB dormant. |
| realtime-and-push | divergent-by-design | L1 push-free; push originates at decoded L2/L3 via durable outbox + webhooks (Chainhooks owns raw push). Sound, not a violation. |

## 3. Where Secondlayer EXCEEDS the reference model

- **A third layer (L3 Subgraphs) the reference model only aspired to.** the reference model hand-waved a future The-Graph-like layer; Secondlayer ships it end to end: typed `defineSubgraph` DSL, per-tenant Postgres DDL with hash-driven migrations, hot-reloadable TS handlers, claimable backfill/reindex operations, per-subgraph REST + SSE + typed SDK query client. The typed client *is* the reference model's anticipated "Prisma-ORM wrapper."
- **Cryptographic proofs for the live API today.** the reference model listed proofs as a *future* goal. Secondlayer ed25519-signs response bytes (`respondSignedJson`, X-Signature), publishes the key at `/public/streams/signing-key` (no shared secret), and the SDK verifies + detects key rotation. Operator attestation, ahead of schedule.
- **Three availability lanes, not one.** Live cursor API (hot), bulk parquet dumps on R2 (cold, content-addressed sha256 + immutable), and `/v1/index/canonical` (cheap unmetered sync map). the reference model described one Hasura surface.
- **Agent-native authoring (MCP).** Same scaffold codegen + schema-hash exposed to agents; spec/openapi/docs generated from the same registries the handlers enforce, so docs can't drift. Beyond the reference model's brief.
- **Dogfooded node-free sync.** The l2-decoder consumes L1 *only* over the public Streams HTTP API — the decode layer is the proof that consumers need no Stacks node.
- **Datasets as immutable content-addressed partitions** with sha256 + min/max cursor + row_count manifests, `latest.json`/history pointers, overwrite-refused-without-`--force`.

## 4. Real Gaps (ordered by severity)

### G1 — [HIGH] No schema contract between API read edge and the indexer's write tables
**What:** Every public read surface runs raw `sql` straight into the indexer's own write schema via `getSourceDb()`. Streams reads `FROM events/blocks`; Index reads `FROM decoded_events`; Datasets read `FROM sbtc_events/sbtc_token_events`. There are zero DB views (no `CREATE VIEW` in 88 migrations) to act as a stable contract, and the read paths use hand-declared row types (`IndexEventRow`, `SbtcEventDbRow`) *not* derived from the shared Kysely schema — so the producer's typed `.insertInto` would fail-compile on a rename, but the consumer's raw-SQL reads get **zero compile-time signal**.
**Evidence:** `packages/api/src/index/events.ts:338`; `packages/indexer/src/streams-events.ts:411/481/546`; `packages/api/src/datasets/sbtc/query.ts:323/511`; no view in `packages/shared/migrations`.
**Why it matters:** This is the dominant the reference model divergence. The whole premise is that the capture service exposes a clean contract so higher layers stay simple. A column rename in the indexer breaks every public read surface at runtime with no signal.
**Fix:** Either (a) move all source-table SQL into ONE owned module per producer (indexer already exports `readCanonicalStreamsEvents`; do the same for `decoded_events`/datasets so `api` never writes table-name SQL) + a schema-snapshot contract test that fails CI on drift; or (b) route api reads through the same internal HTTP path the l2-decoder already uses, making the boundary a real network contract.

### G2 — [HIGH→MEDIUM] Stacking domain coverage is off-by-default and bypasses the layer model
**What:** `/v1/index/stacking` reads `pox4_calls`, populated by the pox-4 decoder, which is (a) OFF by default (`POX4_DECODER_ENABLED` must `=== 'true'`) and (b) the lone decoder that reads L1 directly from the `transactions` Postgres table via `getSourceDb` instead of the Streams HTTP API. Mainnet-only v0. That single `getSourceDb` import is what keeps the l2-decoder process physically coupled to the indexer DB.
**Evidence:** `packages/api/src/index/stacking.ts:165,215`; `packages/indexer/src/l2/decoders/pox-4.ts:1,69-70` (vs `decoder.ts:358` `createInternalStreamsClient`).
**Why it matters:** Stacking is one of the reference model's four named event families; in a default deploy the domain object is empty, and where enabled it breaks the "each layer consumes the layer below via its contract" principle. Severity moderated to MEDIUM: it's intra-monorepo write-schema coupling, contained blast radius (mainnet v0), and pox-4 plausibly needs contract-call columns the event API doesn't surface.
**Fix:** Re-source pox-4 from `print`/`contract_call` events (or `/v1/index/transactions`, which already serves raw_tx-decoded docs) over HTTP like the other decoders, then delete the `getSourceDb` import from the l2 decoder package. Until then, document stacking as opt-in and exclude pox-4 from any "L2 is cleanly decoupled" claim.

### G3 — [HIGH→MEDIUM] reorg.ts event-type list drift undercounts orphaned_to cursor on post-rename print blocks
**What:** Print events carry two DB labels across the node rename (~mainnet 7828030): `smart_contract_event` (legacy) and `contract_event` (current). `streams-events.ts` correctly lists both; `reorg.ts:9-21` maintains a **forked local copy** that omits `contract_event`. `handleReorg` uses it to `COUNT(*)` events at the orphaned tip for `orphaned_to_event_index` written into the immutable `chain_reorgs` ledger, so on post-rename blocks the stored cursor undercounts trailing prints.
**Evidence:** `packages/indexer/src/reorg.ts:9-21,59-71` vs `packages/indexer/src/streams-events.ts:31-32,340`; `parser.ts:295` writes node type verbatim.
**Why it matters / corrected severity:** The adversarial verify **REFUTED the high-severity cross-service-break claim** and downgraded it: NO in-tree consumer (subgraphs reorg poll, subscription chain-reorg handler, l2 `handleDecodedEventsReorg`, SDK consumer) reads `orphaned_to.event_index` — all reorg recovery is block-height-granular and idempotent (`>= forkHeight`), and the SDK self-heals by `fork_point_height` rewind. The bug writes incorrect data into an effectively-unconsumed ledger field. Real but latent/external; downgraded to **MEDIUM** (data-accuracy hygiene), not a live contract violation. Note: the same drift also means `reorg.ts`'s `new_canonical_tip` is pinned to `forkPoint:0` rather than the real new tip ([LOW] mislabel, SDK ignores it).
**Fix:** Delete the local list; import the canonical `STREAMS_DB_EVENT_TYPES` from `streams-events.ts` / `@secondlayer/shared`. Add a regression test reorg-ing a post-rename block with `contract_event` prints, asserting `orphaned_to.event_index` equals the live firehose count.

### G4 — [MEDIUM] Shared single Postgres is the integration bus; dual-DB split wired but dormant
**What:** All five services use one `DATABASE_URL`. `getSourceDb()`/`getTargetDb()` fall back to it, so `getSourceDb()===getTargetDb()` in prod (no `SOURCE_/TARGET_DATABASE_URL` anywhere in `docker/`). Raw chain, index clock, decoded L2, subgraph tenant schemas, subscription_outbox, and accounts/billing share one instance — a single lock-contention and failure domain.
**Evidence:** `packages/shared/src/db/index.ts:66-76`; `docker/docker-compose.yml:170,226`.
**Why it matters:** the reference model's services own independent stores. Here boundaries are process-only; the DB is the dominant coupling. Mitigation: the split path is fully pre-wired (the cleanest available route to separation).
**Fix:** Split the platform/billing schema (accounts, api_keys, sessions, usage) onto `TARGET_DATABASE_URL` first — most independent concern (worker already only touches it + Stripe), removes auth/metering contention from the ingest hot path. Validate `getSourceDb()!==getTargetDb()` end-to-end in staging.

### G5 — [MEDIUM] Independent scale / failure isolation is limited
**What:** (1) api rate-limiting is a process-local `SlidingWindow` (explicit Redis TODO) — horizontal api scale breaks rate-limit correctness. (2) Indexer HTTP receiver fans out, but all write loops are single-leader behind one advisory lock — the writer side does not scale. (3) Three images back seven services (subgraph-processor + migrate on api image, l2-decoder on indexer image); processor had to disable the inherited :3800 healthcheck — an image-sharing smell. (4) The subscription emitter + chain-trigger evaluator are fused INTO the subgraph-processor process, so Subscriptions can't be scaled or failure-isolated from subgraph load.
**Evidence:** `packages/api/src/streams/rate-limit.ts`; `packages/indexer/src/leader.ts`; `docker/docker-compose.yml:163,211,221-223`; `processor.ts:514-522`.
**Fix:** Move rate-limit state to Redis before any api horizontal scale; extract the Subscriptions evaluator+emitter into their own process (durable outbox + `SKIP LOCKED` claims make the cut low-risk); accept image-sharing for now but document the healthcheck-disable.

### G6 — [MEDIUM] subgraph-processor runs the HTTP block-source in prod without `depends_on api`
**What:** In prod the processor sets `SUBGRAPH_SOURCE=streams-index`, routing eligible subgraphs + the chain-trigger evaluator + PublicApiBlockSource over HTTP to `api:3800` — but the hetzner processor block adds NO `depends_on api` (inherits only migrate+postgres). The l2-decoder, with the same HTTP dependency, correctly declares `depends_on api: service_healthy`.
**Evidence:** `docker/docker-compose.hetzner.yml:109-115` vs `docker/docker-compose.yml:191-193`; `block-source.ts:129-133`.
**Why it matters:** Startup/restart ordering hazard during the documented 1-2 min 502 deploy window. It self-heals via poll/retry, but the contract is undeclared and asymmetric.
**Fix:** Add `api: condition: service_healthy` to the hetzner processor `depends_on`.

### G7 — [LOW] Bulk parquet manifest is sha256-checked but unsigned
**What:** Live API is ed25519-signed; the parquet cold lane verifies per-file sha256 but the manifest itself is served unsigned, so the chain of trust roots in an unsigned doc. A forged manifest could point to forged sha256s.
**Evidence:** `packages/sdk/src/streams/dumps.ts`; `packages/indexer/src/streams-bulk/manifest.ts`; `status.ts:304`.
**Fix:** Sign the bulk manifest with the same ed25519 key (signature field or X-Signature on the manifest endpoint). Low priority unless dumps are served from untrusted mirrors/CDN edges.

### G8 — [LOW] Retention windows cap node-free resumability by tier
**What:** `streamsRetentionWindow` rejects reads older than tier horizon (free 7d / build 30d / scale 90d / enterprise unlimited); offline consumers past their window must fall back to parquet — the resume guarantee is split across hot API + cold dumps.
**Evidence:** `packages/api/src/streams/retention.ts`; `streams/tiers.ts`.
**Fix:** On the 403, return a structured pointer to the dumps manifest covering the rejected range so SDK consumers fail over transparently.

### G9 — [LOW] ORM output is a bespoke SecondLayer client, not portable schema emission
**What:** Delivers an ORM-*like* typed client but no Prisma/Drizzle/Kysely schema emission; consumers are locked into the SDK client shape (esp. valuable to address in BYO mode where the user owns the DB).
**Evidence:** `packages/subgraphs/src/infer.ts`; `packages/cli/src/generators/subgraphs.ts`.
**Fix:** `sl subgraphs codegen --target prisma|drizzle|kysely`. Low priority — typed client already covers most ergonomics.

> Findings the adversarial verify REFUTED or downgraded are reflected above: G3 downgraded HIGH→MEDIUM (unconsumed ledger field, block-height-granular recovery insulates all consumers); G2 downgraded HIGH→MEDIUM (intra-monorepo coupling, contained blast radius). No finding was dropped outright — all reproduce in source.

## 5. Microservice-Boundary Assessment

**Is shared-Postgres-as-bus the right call?** For current scale, yes — as a deliberate, *temporary* tradeoff. It is NOT right as the permanent contract, for three reasons:

1. **No contract = silent breakage (G1).** The wire surface is clean (JSON envelopes, registry-driven column whitelists, opaque cursors), but the implementation binds `api` to the indexer's physical table layout via raw SQL with no view and no shared read types. This is the single most important thing to fix because it converts every producer schema change into a latent prod incident.
2. **The right seams already exist and are partial.** The l2-decoder→api HTTP path and PublicApiBlockSource→api are genuine the reference model-style network contracts. They prove the model works. But streams-index is opt-in/eligibility-gated (array-form sources fall back to the DB tap), and pox-4 bypasses it entirely. Make the HTTP seam the *default*, shrink the ineligible-source set, then delete PostgresBlockSource.
3. **The split is pre-wired but dormant (G4).** `SOURCE_/TARGET_DATABASE_URL` + separate listener URLs exist; nothing uses them. This is divergence-by-necessity, not by-design — it should be on the roadmap, starting with the platform/billing schema.

**Independent deploy / scale / failure isolation:** Currently capped (G5). Process-local rate-limit blocks api horizontal scale; single-leader write loops block indexer writer scale; the Subscriptions emitter is fused into the subgraph-processor so push SLA is coupled to subgraph backfill load. The receiver scales; the writers and the push lane do not. Three images for seven services couples build/deploy lifecycles.

**Verdict on boundaries:** Harder contracts ARE warranted between capture/serve specifically — not necessarily separate DBs tomorrow, but (a) an enforced internal read contract (owned module + snapshot test, or HTTP) so the API stops reaching into producer tables, and (b) extraction of the Subscriptions push lane into its own process. Capture/decode can stay co-located on shared Postgres for now if it's an explicit cost decision; document it as such.

## 6. Coverage vs the reference model's Domain-Object Surface

| the reference model domain object | Secondlayer | Notes |
|---|---|---|
| Blocks | ✅ `/v1/index/blocks` + `/blocks/:ref` | Full. |
| Confirmed tx | ✅ `/v1/index/transactions` + `/:tx_id` | Raw_tx decoded at read (fee/nonce/post-conditions/payload). Caveat: returns `reorgs:[]` — its block_height:tx_index cursor can't address the event-indexed reorg ledger. |
| Mempool tx | ✅ `/v1/index/mempool` + `/:tx_id` | Pending txs; never cached. |
| FT/NFT/STX events | ✅ 11 decoded types in `decoded_events` | Deterministic, versioned, replayable. |
| Stacking events | ⚠️ `/v1/index/stacking` (pox4_calls) | OFF by default + DB-tapped (G2). |
| Canonical block-hash map | ✅ `/v1/index/canonical` | Faithful PR#1166 realization; unmetered. |
| **Microblocks** | ❌ Absent | Divergent-by-design: Nakamoto removed microblocks. Only vestigial `microblock_hash` column + `poison_microblock` tx type. Keep as-is; note intentional. |
| **Attachments** | ❌ Absent | `/attachments/new` is an explicit no-op sink. Atlas zonefiles superseded; BNS covered by the bns decoder. Acceptable. |
| **Clarity state indexing (PR#3054)** | ❌ Absent | the reference model *future* goal; no historical on-chain state-value tracking. The Subgraphs layer (user-defined TS handlers) is the natural home if/when needed — not a raw-capture concern. Defer. |

**Tx-document reorg caveat** is the one real coverage defect here: confirmed-tx consumers don't get the at-least-once reconciliation signal the event endpoints provide. Add a tx-cursor-addressable reorg reader.

## 7. Prioritized Recommendations

### P0
- **P0-1 — Enforce an internal read contract (G1).** Move all source-table SQL into one owned module per producer (extend the `readCanonicalStreamsEvents` pattern to `decoded_events` + datasets) and add a schema-snapshot/contract test that fails CI on column drift. Highest leverage: removes the silent-breakage hazard on every public read edge.
- **P0-2 — Single-source the reorg event-type vocab (G3).** Delete `reorg.ts`'s local `STREAMS_DB_EVENT_TYPES`; import the shared one. Add the post-rename reorg regression test. Trivial fix, removes a known data-accuracy defect.

### P1
- **P1-1 — Re-source pox-4 over HTTP and delete `getSourceDb` from the l2 decoder package (G2).** Restores the layer contract and physically decouples l2-decoder from the indexer DB. Decide stacking default-on vs documented-opt-in.
- **P1-2 — Add `depends_on api: service_healthy` to the hetzner subgraph-processor (G6).** One-line ordering fix matching the l2-decoder.
- **P1-3 — Move rate-limit state to Redis (G5).** Prerequisite for any api horizontal scale.
- **P1-4 — Split the platform/billing schema onto `TARGET_DATABASE_URL` (G4).** First real step toward data-boundary separation; lowest-coupling concern.

### P2
- **P2-1 — Extract Subscriptions (evaluator + emitter) into its own service (G5).** Durable outbox + `SKIP LOCKED` make the cut low-risk; decouples push SLA from subgraph backfill load. Optionally wake the evaluator on `indexer:new_block` NOTIFY for lower latency.
- **P2-2 — Make streams-index the default block source; shrink the ineligible-source set; delete PostgresBlockSource (G5/boundaries).** Collapses two block-source impls to one network boundary.
- **P2-3 — Sign the bulk parquet manifest (G7).** Cold-lane parity with the live API.
- **P2-4 — Retention-403 → dumps-manifest pointer (G8); `sl subgraphs codegen --target prisma|drizzle|kysely` (G9); tx-cursor-addressable reorg reader (§6 caveat).** Ergonomics + coverage polish.

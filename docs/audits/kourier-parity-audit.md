# Secondlayer Data Plane — Service Parity Audit vs Project Kourier

> Service-centric companion to `docs/audits/data-plane-audit.md` (boundary-centric). Per-service API/arch/DX read against Kourier's 5 DX goals + the microservice-decomposition premise. Adversarially-verified gaps only; refuted findings dropped. Generated 2026-06-05.

## 1. Executive verdict

Secondlayer is ~85% parity with Project Kourier's data-plane intent and EXCEEDS it on typed-ORM authoring, agent-native (MCP) author→deploy→query loops, immutable-page caching, and reorg-rollback delivery — primitives Kourier never specified. The single most important remaining gap is **service isolation**: the source/target DB split is wired but DORMANT in prod, so all 7 services share one Postgres failure domain, and the realtime plane (emitter + chain evaluator + reorg handler) is fused into one un-scalable subgraph-processor. Net: the data is correct, fast, and cacheable; what's missing is independent scale/deploy/failure-isolation, plus two architectural-shape divergences (no GraphQL read layer; real-time is poll/SSE not true push).

## 2. Parity scorecard

| Kourier goal / principle | Streams (M1) | Index (M2) | Subgraphs | Subscriptions | Agent-native/DX | Perf & Sync |
|---|---|---|---|---|---|---|
| G1 — no Stacks node | aligned | aligned | partial¹ | aligned | exceeds | aligned |
| G2 — easy access to data types | aligned | partial² | exceeds | aligned | aligned | aligned |
| G3 — fast sync (initial+incremental) | exceeds | partial³ | aligned | aligned | partial⁴ | aligned |
| G4 — update/re-sync as needed | partial | aligned | exceeds | partial⁵ | aligned | aligned |
| G5 — real-time streaming | partial⁶ | n/a | aligned | aligned | partial⁴ | aligned |
| Microservice decomposition | aligned⁷ | partial⁷ | aligned⁷ | divergent⁸ | exceeds | partial⁸ |

¹ Streams+Index data plane shipped & live in prod, but per-subgraph eligibility gate + in-code default still falls to the Index Postgres tap. ² No trait-filter on Index reads (trait discovery shipped via `/v1/contracts`+Subgraphs). ³ next_cursor over-emit + per-row block-metadata subqueries. ⁴ No MCP consume/resume or ORM-codegen tool. ⁵ Chain subs have no replay/catch-up. ⁶ Poll-only; no SSE/websocket. ⁷ DB split dormant → logical-only. ⁸ Emitter/evaluator fused, no leader election.

## 3. Per-service sections

### 3.1 Streams (Kourier M1 — Raw Event Capture / availability)
**Verdict:** Strong, well-architected M1: opaque keyset cursors, seek-method pagination, immutable tip-stable ETags, ed25519-signed live responses, three availability lanes (live API, cold parquet dumps, canonical map). Exceeds M1 minimum on SDK reorg-safe consume + dump/live replay seam.

**Top strengths:** opaque `<height>:<event_index>` cursor single-sourced in `@secondlayer/shared` w/ documented inclusive-out/exclusive-in semantics; true UNION seek-method pagination (`streams-events.ts:548-642`); finalized-page immutable cache + 304-before-metering (`routes/streams.ts:221-254`); ed25519 signing over exact bytes w/ rotation-aware SDK verify; SDK `replay()` seam-stitches dumps→live tail with exclusive-cursor dedup.

| id | sev | status | title | fix |
|---|---|---|---|---|
| streams-realtime-push-surface | MEDIUM | known-open | No SSE/websocket; real-time is poll-only (500ms backoff) | Add `GET /v1/streams/events/stream` (text/event-stream) reusing envelope+signing; SDK `client.events.subscribe()`. SSE prior art exists in subgraphs. |
| streams-bulk-manifest-unsigned (G7) | MEDIUM | known-open | Cold manifest sha256-only, not ed25519-signed | Sign manifest at export w/ same key (`manifest.sig`/`key_id`); SDK verifies manifest sig before trusting file sha256. |
| streams-retention-403-no-dumps-pointer (G8) | LOW | known-open | Retention 403 has no pointer to dumps lane | Enrich 403 body: `code:'RETENTION'` + `dumps_manifest_url` + one-line hint (needs structured-body field on AuthorizationError). |
| streams-no-advertised-retention-floor | LOW | new | Seekable range not advertised in tip/usage | Add `oldest_seekable_height`/`oldest_cursor` to `/tip` and `/usage` from `getStreamsRetentionCutoff`. |
| streams-from-block-legacy-alias | LOW | new | Legacy `from_block` half-honored (retention yes, events no) → 403/400 split | Drop `from_block` from retention (delete-over-refactor); migrate `routes.test.ts:197-208` to `from_height`. |

_Refuted: streams-graphql-hasura-parity — GraphQL is a documented Non-goal (`docs/prds/0002-stacks-index.md:25`) and REST-as-read-layer is already documented._

### 3.2 Index (Kourier M2 — Data Transformation / domain objects)
**Verdict:** Faithful M2: derives canonical domain objects node-free over Streams HTTP, canonical-only sync, lean canonical block-hash map, finality-aware immutable/ETag/304 caching that exceeds spec.

**Top strengths:** registry-driven event surface (`INDEX_EVENT_CONFIG`) machine-emits discovery so docs can't drift; consistent `{items,next_cursor,tip,reorgs}` envelope; node-free derive via `l2/index-client` + pox-4 over HTTP; canonical-only enforced end-to-end with checkpoint-driven reorg rewind; DI-tested readers.

| id | sev | status | title | fix |
|---|---|---|---|---|
| stacking-no-reorgs | MEDIUM | new | Stacking endpoint omits `reorgs[]` (lone height-keyed list without it) | Add `reorgs[]` to `StackingResponse`; wire `readChainReorgsForHeightRange` in `getStackingResponse` mirroring contract-calls. |
| g4-db-split-dormant | MEDIUM | shipped-partial | Source/target split wired but dormant; M1/M2 share one Postgres | Founder cutover: stand up postgres-platform, set `TARGET_DATABASE_URL`, move control-plane tables (decoded tables stay on SOURCE per design). |
| cursor-grammar-divergence | LOW | new | mempool seq-int cursor breaks advertised `h:N` shape (events/tx share plain `h:N`, not base64) | Wrap mempool seq in opaque envelope; doc per-endpoint semantics. |
| block-metadata-correlated-subqueries | LOW | ~~new~~ REFUTED | Per-row scalar subqueries for block_time/burn_block_height | **Won't-do (2026-06-06).** EXPLAIN (forced-index) shows the JOIN yields the IDENTICAL plan: every reader is LIMIT-bounded (≤1000) and `blocks.height` is the PK, so the correlated subquery is O(LIMIT) `blocks_pkey` probes, NOT O(table) — a nested-loop JOIN does the same probes. No query-plan or scaling win; and for `transactions`/`contract-calls` (no `canonical` column) a naive LEFT JOIN risks including orphaned rows unless canonicality is carefully preserved. Churn + risk for zero benefit. |
| trait-filtering-absent-at-index | LOW | ✅ SHIPPED | No `trait=` param on Index event/call reads | DONE (2026-06-06): `trait=` on `/v1/index/events` (contract-keyed types) + `/contract-calls` via `resolveTraitContractIds`. |
| portable-schema-emission (G9) | LOW | known-open | No emittable schema for Index domain objects | Emit Prisma/Drizzle/JSON-Schema from `SOURCE_READ_COLUMNS` registry. |

_Refuted: next-cursor-over-emission — all 7 readers over-emit identically (events/contract-calls' LIMIT+1 is vestigial; no reader checks `rows.length>limit`). Uniform LOW cursor convention, not a 5-vs-2 divergence._

### 3.3 Subgraphs (tooling layer — custom views + typed ORM + trait filtering)
**Verdict:** Most complete tooling-layer realization; exceeds Kourier in places. End-to-end type inference, full trait/contract/function/asset filtering, G9 effectively shipped via Prisma+Drizzle codegen, schema-hash-driven deploy + resumable reindex engine beyond baseline.

**Top strengths:** `defineSubgraph` const-literal inference (per-source handler events, schema-typed ctx, ABI-named args, per-topic print typing); rich handler ctx (insert/upsert/patch + count/sum/min/max/countDistinct); `TraitScope` resolves SIP-009/010/stacking per-block; `BlockSource` seam (Postgres tap vs Streams+Index HTTP); schema-hash deploy (no-op/additive ALTER/breaking auto-reindex) + adaptive resumable reindex/backfill; per-tenant DDL isolation + BYO refuse-destructive guard; reorg row-delete + idempotent `.reverted` events; static-analysis scaffolding; `--dry-run` DDL+grant preview.

| id | sev | status | title | fix |
|---|---|---|---|---|
| subgraphs-aggregate-query-api | LOW | new | sum/min/max/countDistinct on handler ctx but not public REST/SDK | Add `/:table/aggregate` REST + typed `client.aggregate()` mirroring ctx. |
| subgraphs-additive-ddl-duplication | LOW | new | Additive create-table path omits UNIQUE/composite-idx/FK/defaults → upsert ON CONFLICT can fail at runtime | Factor one per-table DDL emitter shared by generator + deployer. |
| subgraphs-byo-no-emitted-migration | LOW | new | BYO breaking change → manual DROP SCHEMA, no reviewable migration | Emit migration plan via existing `diffSchema`/`renderDeployPlan`. |
| subgraphs-sse-replay-unbounded | LOW | new | `?since` SSE replay seeds `_id=0`, scans whole table | Seed from `MIN(_id) WHERE _block_height>=since` or add `(_block_height,_id)` index. |

_Refuted: subgraphs-graphql-read-layer (intentional, documented divergence; typed-REST+ORM covers it); subgraphs-streams-index-default-dormant (LIVE in prod per `hetzner.yml:120`, golden-diff 0); subgraphs-abi-typed-input-beyond (shipped strength, not a gap)._

### 3.4 Subscriptions (webhooks on chain + subgraph events — Kourier G5 push)
**Verdict:** Most operationally mature surface. Durable transactional outbox, content-hash dedup, SKIP-LOCKED competing consumers, 7-step backoff, per-sub circuit breaker, DLQ/requeue, SSRF guard, precise chain-reorg rollback envelopes. Adds G2 trait/contract push via direct chain triggers (#8).

**Top strengths:** Zod-discriminator + DB CHECK enforce subgraph-XOR-chain at API and storage; 13-type chain-trigger union w/ wildcards + trait-scoping (caps 50/sub), 1:1 with subgraph `matchSources`; 6 wire formats w/ safe fallback; transactional outbox commits atomically with row writes; reorg-aware dedup keys; FOR UPDATE SKIP LOCKED + 90/10 live/replay split; reorg rollback envelope w/ orphaned events (bounded 500, truncated flag).

| id | sev | status | title | fix |
|---|---|---|---|---|
| emitter-evaluator-fused-in-processor (G5) | MEDIUM | known-open | Emitter+evaluator+reorg fused into subgraph-processor | Extract dedicated subscription-processor entrypoint (`startEmitter`+`startTriggerEvaluator`+reorg); outbox+SKIP-LOCKED already make it horizontally safe. |
| trigger-evaluator-no-leader-election | MEDIUM | known-open | Evaluator runs per replica, one global cursor, no leader → N× redundant fetch/match (caps at 1 replica) | `pg_try_advisory_lock` leader around tick, or shard cursor by subscription-id. |
| non-default-formats-unsigned | MEDIUM | known-open | Only standard-webhooks HMAC-signed; raw/cloudevents carry no SL authenticity | Attach `webhook-id`+signature header across all formats; export verify helper. |
| subgraph-updates-deletes-not-emitted | MEDIUM | known-open | Subgraph subs emit INSERT only; updates/deletes dropped | Emit `.updated`/`.deleted` from flush manifest (already carries op+pk+row). |
| no-chain-replay-catchup | MEDIUM | known-open | Chain subs have no replay/catch-up; long-down receiver loses events | Re-run evaluator over historical range w/ replay dedup keys (matcher is pure/range-driven). |
| no-test-event-endpoint | LOW | ✅ SHIPPED | No server/SDK/MCP test-delivery | DONE (2026-06-06): `POST /:id/test` via `deliverTestEvent` (buildForFormat + SSRF + delivery row, null outbox_id) + SDK `subscriptions.test()` + MCP `subscriptions_test` + CLI `--post` routed through the server (`--local` for client-side). |
| chain-envelope-undocumented-untyped | LOW | new | `chain.*.apply`/`chain.reorg.rollback` shapes code-only, untyped | Export `ApplyEnvelope`/`RollbackEnvelope` from SDK + document. |

### 3.5 Agent-native + cross-cutting DX (MCP, SDK, CLI, scaffold, codegen)
**Verdict:** Strong; EXCEEDS Kourier (which never specified an agent-native surface). Full MCP author→deploy→query→discover loop, auto-generated CAPABILITIES from live tool registry, principled SDK error/auth model, Prisma+Drizzle ORM emission (closes G9, Kysely aside).

**Top strengths:** MCP spans all 4 surfaces + datasets/contracts/account; normalized tool-error envelope; `ApiError` w/ status+code+body + `VersionConflictError`; framework-agnostic `verifyWebhookSignature`; single-source `DECODED_EVENT_TYPES`/`CHAIN_TRIGGER_TYPES` vocab; auto-generated CAPABILITIES; `SL_API_KEY`-only env transport; static-analysis scaffold contract→deploy→query node-free.

| id | sev | status | title | fix |
|---|---|---|---|---|
| mcp-resources-filters-columns-drift | MEDIUM | new | MCP `FILTERS_REFERENCE`/`COLUMN_TYPES` hand-maintained, already drifted (omits `timestamp`, uses `bool`/`json` vs validator's `boolean`/`jsonb`) → agents emit validator-rejected schemas | Derive from `EventFilter` + `ColumnType` union/`TYPE_MAP`; add G1-style drift snapshot test. |
| mcp-no-orm-codegen-tool | MEDIUM | shipped-partial | ORM codegen CLI-only; unreachable from MCP | Add `subgraphs_codegen` MCP tool calling same generators. |
| cli-streams-vocab-drift | LOW | new | CLI `VALID_TYPES` hand-duplicated, not from shared (stale-subset risk) | `import { DECODED_EVENT_TYPES } from '@secondlayer/shared'`; add to CI drift test. |
| mcp-no-streams-consume-resume | LOW | new | No agent-native consume/resume primitive (resume/reorg logic SDK/CLI-only) | Add bounded `streams_consume` tool (matches existing `workflows_tail_run` pattern). |
| kysely-emission-missing | LOW | shipped-partial | Kysely codegen unsupported (Prisma+Drizzle ship) | Emit `kysely.ts` mirroring prisma/drizzle, or formalize kysely-codegen config. |
| subgraph-source-readonly-edit-hole | LOW | shipped-partial | `subgraphs_read_source` readOnly for pre-capture subs; misleading "via CLI" wording | Align MCP/API wording to MCP `subgraphs_deploy` (which already recovers the loop). |

### 3.6 Performance & Sync / Service-Isolation (indexer + api + subgraphs + shared/db + docker)
**Verdict:** Good on speed/sync (goals 3/4/5); weak on isolation/availability. Atomic chunked ingest, parallelized backfill, immutable+ETag read plane, claimable reindex, correct horizontal primitives. Real weaknesses are isolation, not throughput.

**Top strengths:** finalized pages `max-age=31536000, immutable`; indexer singletons advisory-lock leader-gated w/ lock-still-held ping; `persistBlock` fully atomic per block (chunked under bind-param limit); subgraph ops row-claim+heartbeat; emitter/cursor FOR UPDATE SKIP LOCKED; Redis atomic Lua sliding-window rate limit fail-open (G5a).

| id | sev | status | title | fix |
|---|---|---|---|---|
| shared-postgres-bus-dormant-split | HIGH | shipped-partial | Split dormant in prod → all 7 services share one Postgres failure domain | Execute G4 cutover (postgres-platform default, `TARGET_DATABASE_URL` set); add /status split-active assertion. |
| three-images-seven-services | MEDIUM | known-open | 7 services from 3 images; subgraph-processor/l2-decoder reuse api/indexer images → no independent deploy/rollback | Split into own Dockerfile targets/images. |
| subgraph-processor-no-leader | MEDIUM | known-open | Catch-up loop in-process Set only; can't scale out (2+ procs double-process) | Advisory-lock catch-up (mirror `leader.ts`) or shard subgraphs by hashed claim. |
| deploy-502-window-no-replicas | MEDIUM | known-open | Every push recreates single API container → 1-2 min 502; no replicas behind Caddy | N>1 api behind Caddy + rolling/blue-green recreate. |
| processors-depend-on-api | LOW | ✅ SHIPPED | streams-index processors `depend_on api:healthy` → flapping API stalls data plane | DONE (2026-06-06): `FallbackBlockSource` wraps the HTTP source and falls back to the Postgres tap per-call when api is down (subgraph processor + chain evaluator), so the plane keeps advancing. `depends_on` kept as belt-and-suspenders. (N>1 api replicas already mitigate much of it.) |

_(G7 bulk-manifest-unsigned also surfaces here — tracked once under Streams.)_

## 4. Where we EXCEED Kourier

- **Agent-native authoring (entirely beyond Kourier):** full MCP author→deploy→query→discover loop across all 4 surfaces; `scaffold_from_contract` (ABI fetch→`defineSubgraph`) node-free; auto-generated CAPABILITIES from the live tool registry (can't drift).
- **Typed-ORM end-to-end (G9):** `defineSubgraph` const-literal inference + portable Prisma+Drizzle codegen mirroring deployed DDL (lossless Numeric, relations).
- **Immutable-leverage caching:** finalized-page `immutable` Cache-Control + tip-stable ETag + 304-before-metering + in-memory finalized-page cache (M1 "aggressively cacheable" realized at HTTP layer).
- **Cryptographic authenticity (live lane):** ed25519-signed responses w/ published key + rotation-aware SDK verify — Kourier's "future" authenticity proof, shipped.
- **Reorg-rollback delivery:** subscriptions emit precise `chain.reorg.rollback` undo envelopes (bounded+truncated flag) — beyond fire-and-forget webhooks.
- **Three availability lanes:** live cursor API + cold parquet dumps + canonical map, seam-stitched in SDK `replay()` — richer than the single Hasura surface Kourier specified.
- **Schema-update story (G4):** schema-hash-driven no-op/additive-ALTER/breaking-auto-reindex + resumable adaptive reindex/backfill w/ gap tracking + dry-run.

## 5. Prioritized roadmap (real open gaps; G1-G4/G5a/G-txreorg already shipped, excluded)

**P0 — isolation/availability (highest leverage, dependency-aware):**
1. `shared-postgres-bus-dormant-split` (HIGH) — execute G4 cutover; this is the blocker behind the whole decomposition premise. *Founder decision required.*
2. `deploy-502-window-no-replicas` (MEDIUM) — N>1 api behind Caddy + rolling recreate; also unblocks #5 below (gives processors a stable upstream).

**P1 — realtime plane scale + correctness:**
3. `emitter-evaluator-fused-in-processor` + `trigger-evaluator-no-leader-election` (MEDIUM, paired) — extract subscription-processor AND add advisory-lock/shard leader; one without the other doesn't yield scale-out.
4. `subgraph-processor-no-leader` (MEDIUM) — advisory-lock catch-up; same pattern as #3, share the leader util.
5. `stacking-no-reorgs` (MEDIUM) — mirror shipped G-txreorg fix; small, same class.
6. `subgraph-updates-deletes-not-emitted` (MEDIUM) — emit `.updated`/`.deleted` from flush manifest.
7. `non-default-formats-unsigned` (MEDIUM) — universal authenticity header across formats.
8. `no-chain-replay-catchup` (MEDIUM) — chain replay over historical range.
9. `streams-realtime-push-surface` (MEDIUM) — SSE lane (reuse subgraphs prior art).
10. `streams-bulk-manifest-unsigned` / G7 (MEDIUM) — sign manifest; depends on existing `STREAMS_SIGNING_PRIVATE_KEY`.

**P2 — DX/anti-drift/polish:**
11. `mcp-resources-filters-columns-drift` (MEDIUM) — derive MCP refs from shared vocab + drift test (active mis-guidance, but DX-only).
12. `three-images-seven-services` (MEDIUM) — split Dockerfile targets (gated behind P0 #1 cutover for max value).
13. `mcp-no-orm-codegen-tool` (MEDIUM) — `subgraphs_codegen` MCP tool.
14. `cli-streams-vocab-drift`, `trait-filtering-absent-at-index`, `subgraphs-aggregate-query-api`, `subgraphs-additive-ddl-duplication`, `block-metadata-correlated-subqueries`, `cursor-grammar-divergence`, `streams-from-block-legacy-alias`, `streams-no-advertised-retention-floor`, `streams-retention-403-no-dumps-pointer`/G8, `chain-envelope-undocumented-untyped`, `no-test-event-endpoint`, `subgraphs-byo-no-emitted-migration`, `subgraphs-sse-replay-unbounded`, `mcp-no-streams-consume-resume`, `kysely-emission-missing`, `subgraph-source-readonly-edit-hole`, `processors-depend-on-api`, `portable-schema-emission`/G9 (all LOW) — opportunistic.

## 6. Open questions / founder decisions

1. **G4 DB-home cutover (P0 #1):** approve standing up postgres-platform as default-on in prod and moving control-plane tables to `TARGET_DATABASE_URL`? Whole decomposition premise (independent failure isolation) is logical-only until this lands. Per design, decoded tables stay on SOURCE.
2. **API replicas (P0 #2):** acceptable to run N>1 api behind Caddy (resolves the 1-2 min 502-per-push window)? Low-cost since Caddy already fronts the API; also de-risks the streams-index processor→api coupling.
3. **GraphQL stance:** confirm REST+SSE+typed-ORM is the permanent intentional replacement for Kourier's Hasura read layer (currently a documented Non-goal). If yes, add one explicit "no GraphQL endpoint by design" line to docs to close it as a stated divergence rather than a recurring audit finding.
4. **Streams real-time shape:** SSE (poll-loop wrapped in event-stream, immutable/cacheable-friendly — matches subgraphs) acceptable for goal 5, or is true websocket push desired?

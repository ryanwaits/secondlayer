# Kickoff — P2: DX, Anti-Drift & Polish

> **First read `docs/sprints/kourier-kickoffs/_context.md` and `docs/audits/kourier-parity-audit.md` (§3.x gap tables, §5 P2).**
>
> **Goal of this session:** diagnose the P2 findings, group them into coherent themed sprints (anti-drift, agent-native parity, ergonomics polish), and produce + review a plan. These are independent, mostly LOW, opportunistic — batch by theme and ship as bandwidth allows. Two items gate on other tiers (noted).

---

## Tier A — MEDIUM (do first; active mis-guidance or lifecycle coupling)

### P2-A1 — MCP filters/column-type resources hand-maintained + already drifted  `[MEDIUM]`
**id:** `mcp-resources-filters-columns-drift` · status: new. **Highest-value P2** — agents currently emit validator-rejected schemas.
- **Problem.** `FILTERS_REFERENCE` + `COLUMN_TYPES` are literal arrays served on `secondlayer://filters` / `secondlayer://column-types` with no drift guard, and have **already drifted**: COLUMN_TYPES omits `timestamp`, uses `bool`/`json` where the validator requires `boolean`/`jsonb`, and maps uint/int→`bigint` vs the real `NUMERIC`; FILTERS_REFERENCE lists `contract_call:[contract,function]` vs canonical `contractId/functionName/caller`, `print_event:[contract,event,contains]` vs `contractId/topic/contains`.
- **Evidence.** `packages/mcp/src/resources.ts:7-36` (FILTERS_REFERENCE), `:38-62` (COLUMN_TYPES). Canonical sources: `EventFilter` in `packages/shared/src/schemas/filters.ts`; `ColumnType` union `packages/subgraphs/src/types.ts:4-11` + `ColumnTypeSchema` `packages/subgraphs/src/validate.ts:19` + `TYPE_MAP` `packages/subgraphs/src/schema/generator.ts:5-13`. CAPABILITIES already has a drift guard (`resources.test.ts:81-93`); these two do not.
- **Fix.** Derive FILTERS_REFERENCE from `EventFilter` (NOT ChainTrigger — fields differ) and COLUMN_TYPES from the ColumnType union + TYPE_MAP; add a G1-style drift snapshot test.

### P2-A2 — 7 services from 3 images (no independent deploy/rollback)  `[MEDIUM]`
**id:** `three-images-seven-services` · status: known-open. **Gate behind P0-1 cutover** for max value; coordinate with P1-1 (the new subscription-processor needs its own image too).
- **Problem.** `subgraph-processor` + `l2-decoder` run the api/indexer images with a command override — shared image tag + dependency tree, so an api regression grounds the processor and you can't roll one back without the other.
- **Evidence.** `docker/docker-compose.yml:212-218` (l2-decoder uses indexer image + command override), `:264-271` (subgraph-processor uses api image). `docker/Dockerfile` defines only api/worker/indexer/agent targets. `docker/scripts/rollback.sh:41-42,53` (single `DEPLOY_IMAGE_TAG` for all).
- **Fix.** Dedicated Dockerfile targets/images for subgraph-processor, l2-decoder (and the new subscription-processor) so they version/scale/roll back independently.

### P2-A3 — ORM codegen unreachable from MCP  `[MEDIUM]`
**id:** `mcp-no-orm-codegen-tool` · status: shipped-partial (generators ship; only MCP surface missing).
- **Problem.** `generatePrismaSchema`/`generateDrizzleSchema` are wired only into the CLI `codegen` command — an agent that authored+deployed a subgraph can't produce the typed ORM schema for a BYO DB, breaking the "Prisma wrapper for Stacks" agent-native story.
- **Evidence.** `packages/cli/src/commands/subgraphs.ts:1124` (CLI-only import); generators exported at `packages/subgraphs/src/index.ts:54,58`. No prisma/drizzle in `packages/mcp/src`.
- **Fix.** Add a `subgraphs_codegen` MCP tool `{name|code, target:'prisma'|'drizzle', schemaName?}` calling the same generators.

---

## Tier B — LOW: anti-drift & agent-native parity (small, high-clarity)

- **`cli-streams-vocab-drift`** — CLI `VALID_TYPES` hand-duplicated, not from shared (stale-subset risk). Fix: `import { DECODED_EVENT_TYPES } from '@secondlayer/shared'`; add to CI drift test. (pairs naturally with P2-A1)
- **`mcp-no-streams-consume-resume`** — no agent-native consume/resume primitive (resume/reorg logic is SDK/CLI-only). Fix: bounded `streams_consume` MCP tool (match existing `workflows_tail_run` pattern).
- **`kysely-emission-missing`** — Kysely codegen unsupported (Prisma+Drizzle ship). Fix: emit `kysely.ts` mirroring prisma/drizzle, or formalize kysely-codegen config.
- **`portable-schema-emission` (G9)** — no emittable schema for Index domain objects. Fix: emit Prisma/Drizzle/JSON-Schema from the `SOURCE_READ_COLUMNS` registry.
- **`subgraph-source-readonly-edit-hole`** — `subgraphs_read_source` readOnly for pre-capture subs; misleading "via CLI" wording (MCP `subgraphs_deploy` already recovers the loop). Fix: align MCP/API wording.

## Tier C — LOW: ergonomics & API consistency polish

- **`trait-filtering-absent-at-index`** — no `trait=` param on Index event/call reads (trait discovery already ships via `/v1/contracts?trait=` + Subgraphs). Fix: wire `resolveTraitContractIds` into `INDEX_EVENT_CONFIG`/contract-calls.
- **`subgraphs-aggregate-query-api`** — sum/min/max/countDistinct exist on handler ctx but not public REST/SDK. Fix: `/:table/aggregate` REST + typed `client.aggregate()`.
- **`subgraphs-additive-ddl-duplication`** — additive create-table path omits UNIQUE/composite-idx/FK/defaults → upsert ON CONFLICT can fail at runtime. Fix: one per-table DDL emitter shared by generator + deployer.
- **`subgraphs-byo-no-emitted-migration`** — BYO breaking change → manual DROP SCHEMA, no reviewable migration. Fix: emit a migration plan via existing `diffSchema`/`renderDeployPlan`.
- **`subgraphs-sse-replay-unbounded`** — `?since` SSE replay seeds `_id=0`, scans whole table. Fix: seed from `MIN(_id) WHERE _block_height>=since` or add `(_block_height,_id)` index.
- **`block-metadata-correlated-subqueries`** — per-row scalar subqueries for block_time/burn_block_height. Fix: `LEFT JOIN blocks b ON b.height=t.block_height AND b.canonical`.
- **`cursor-grammar-divergence`** — mempool seq-int cursor breaks the advertised `h:N` shape (events/tx use plain `h:N`). Fix: wrap mempool seq in an opaque envelope; doc per-endpoint semantics.
- **`streams-from-block-legacy-alias`** — legacy `from_block` half-honored (retention yes, events no) → 403/400 split. Fix: drop `from_block` from retention (delete-over-refactor); migrate `routes.test.ts:197-208` to `from_height`.
- **`streams-no-advertised-retention-floor`** — seekable range not advertised in `/tip` or `/usage`. Fix: add `oldest_seekable_height`/`oldest_cursor` from `getStreamsRetentionCutoff` (`packages/api/src/streams/tiers.ts:36-43`).
- **`streams-retention-403-no-dumps-pointer` (G8)** — retention 403 dead-ends with no dumps pointer. Fix: enrich 403 body with `code:'RETENTION'` + `dumps_manifest_url` (needs a structured-body field on `AuthorizationError`, `packages/api/src/streams/retention.ts:59-65`).
- **`chain-envelope-undocumented-untyped`** — `chain.*.apply`/`chain.reorg.rollback` shapes are code-only. Fix: export `ApplyEnvelope`/`RollbackEnvelope` from SDK + document.
- **`no-test-event-endpoint`** — `sl subscriptions test --post` exists but logs no delivery row, standard-webhooks-only. Fix: `POST /:id/test` via `buildForFormat`, log delivery row, surface in SDK/MCP.
- **`processors-depend-on-api`** — streams-index processors `depend_on api:healthy`; flapping API stalls the data plane. **Largely resolved by P0-2 (N>1 api replicas).** Residual fix: auto-fallback to the DB tap on API unavailability (unset `SUBGRAPH_SOURCE` path already exists).

---

## Deliverable

A reviewed plan grouping P2 into themed sprints: **Sprint 1 anti-drift** (P2-A1 MCP resources + cli-streams-vocab + their shared drift tests), **Sprint 2 agent-native parity** (P2-A3 MCP codegen + streams_consume + kysely/G9 emission), **Sprint 3 image split** (P2-A2 — gate behind P0-1/coordinate P1-1), then **opportunistic ergonomics** (Tier C, batch by package: streams polish, subgraphs polish, index polish, subscriptions polish). Each task atomic + validated; changeset per package. Note `processors-depend-on-api` is mostly closed by P0-2 — only plan the DB-tap fallback residual.

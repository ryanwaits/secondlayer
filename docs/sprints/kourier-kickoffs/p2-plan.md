# P2 — DX, Anti-Drift & Polish — Sprint Plan

> Produced from `p2-dx-antidrift-polish.md` kickoff + `docs/audits/kourier-parity-audit.md` §3.5/§3.6/§5 P2. All P2 findings re-confirmed against current source (lines below). P0 (DB split + 2 api replicas) and P1 (subscription-processor + leader election) are SHIPPED + prod-live — so the image-split sprint is **no longer gated** and now covers three command-override services.

## Confirmed current state (diagnosis)

- **P2-A1 (filters drift).** `mcp/src/resources.ts:7-36` `FILTERS_REFERENCE` is hand-authored and serves **SubgraphFilter** vocab (its own comment, `:6`) on `secondlayer://filters` (`:192-203`). It has drifted from the actual validator: lists `contract_call:[contract,function]` (canonical `contractId/functionName/caller`), `print_event:[contract,event,contains]` (canonical `contractId/topic/trait` — **no `contains`**), `nft_*:[…,tokenId]` (**no `tokenId`** on SubgraphFilter). The validator `SubgraphFilterSchema` (`subgraphs/src/validate.ts:81-100`) is `.strict()`, so any advertised-but-unknown field (`contains`, `tokenId`, `event`) makes an agent emit a **validator-rejected** schema. Allowed key set = the flat schema's keys: `sender,recipient,minAmount,maxAmount,assetIdentifier,contractId,functionName,caller,deployer,contractName,topic,lockedAddress,abi,trait`. Type set = `VALID_FILTER_TYPES` (`validate.ts:64-78`, local const, **not exported**).
  - **Correction to kickoff:** kickoff said derive from `EventFilter` (shared/schemas/filters.ts). That is the **wrong vocab** — `EventFilter` has `contains`/`tokenId` and no `trait`/`abi`; deriving from it would *perpetuate* the validator-rejection bug. Canonical source is `SubgraphFilter` / `SubgraphFilterSchema` / `VALID_FILTER_TYPES` in **subgraphs**.
- **P2-A1 (column-types drift).** `resources.ts:38-62` `COLUMN_TYPES` served on `secondlayer://column-types` (`:205-217`). Drifted: uses `bool`/`json` (validator wants `boolean`/`jsonb`), omits `timestamp`, maps `uint`/`int`→`bigint` but real `TYPE_MAP` (`subgraphs/src/schema/generator.ts:5-13`) maps them to `NUMERIC`. Canonical: `ColumnType` union (`subgraphs/src/types.ts:4-11`) = keys of `TYPE_MAP`; `ColumnTypeSchema` enum (`validate.ts:19-27`). `TYPE_MAP` **not exported** from `schema/index.ts`.
- **P2-A1 (no drift guard).** CAPABILITIES already drift-tested (`resources.test.ts:81-93`); filters/column-types are not.
- **cli-streams-vocab-drift.** `cli/src/commands/streams.ts:17-29` `VALID_TYPES` is a hand literal (imports the `StreamsEventType` *type* from sdk, `:6`). Canonical const `STREAMS_EVENT_TYPES`/`DECODED_EVENT_TYPES` lives in `shared/src/event-types.ts:7,26` and is barrel-exported. cli already deps `@secondlayer/shared@^6.23.0`. `"print"` singular matches → drop-in.
- **P2-A3 / kysely.** `generatePrismaSchema` (`subgraphs/src/schema/prisma.ts`), `generateDrizzleSchema` (`schema/drizzle.ts`), exported from `subgraphs/src/index.ts:54,58`. Used **only** by CLI `codegen` (`cli/src/commands/subgraphs.ts:1124`); the non-prisma/drizzle branch hard-rejects with "For Kysely, run kysely-codegen" (`:1111-1113`) and `--target` help says "prisma | drizzle". No MCP surface; no kysely generator. SDK already has `streamsClient.events.list({cursor,limit})` + `events.consume` (`sdk/src/streams/client.ts:255,282`).
- **P2-A2 (image split).** 3 images, targets api/worker/indexer/agent (`docker/Dockerfile`). Three services run an image + `command:` override sharing one `DEPLOY_IMAGE_TAG`: `l2-decoder` (indexer image, `docker-compose.yml:243-249`), `subgraph-processor` (api image, `:300-306`), `subscription-processor` (api image, `:350-356`, P1). `deploy.sh` (`APP_SERVICES`/`APP_SERVICES_NO_API`/`_pull_services`) and `rollback.sh` (`APP_SERVICES` + pull line) **omit** subgraph-processor/subscription-processor (they ride along today as image-sharing deps) — dedicated images would silently break their pull/rollback. CI matrix `[api,indexer,worker,agent]` (`deploy.yml:73`, `oss-images.yml:27`).
- **G9.** `SOURCE_READ_COLUMNS` registry (`shared/src/db/source-read-columns.ts`) = canonical Index domain columns; no schema emitter for it.

## Decisions (founder, resolved)

1. **Sprint 3 runs now** — independent deploy/rollback worth the churn.
2. **Per-service image tags, defaulting to shared `DEPLOY_IMAGE_TAG`** — uniform pushes stay one-tag-simple; a single service can be pinned/rolled back independently (the actual decomposition payoff).
3. **Sprint 1 keeps zod-internal derivation** (`_zod.def.shape` key extraction), documented at the call site.
4. **G9 promoted to its own Sprint 4** (reuses the codegen/CLI/MCP plumbing built in Sprint 2).

---

## Sprint 1 — Anti-drift: MCP + CLI vocab single-sourced

**Goal.** `secondlayer://filters` + `column-types` are correct and locked to the subgraphs validator; CLI streams types locked to shared. Demoable: resources emit only validator-accepted fields; drift tests fail if a future filter/column/event type is added without updating the reference.

- [ ] **T1.1: Export the canonical subgraph vocab from `@secondlayer/subgraphs`.** Add `export const TYPE_MAP` re-export to `subgraphs/src/schema/index.ts` (from `./generator.ts`); add `export` to `VALID_FILTER_TYPES` in `validate.ts:64`. `SubgraphFilterSchema`/`ColumnTypeSchema` already exported. → **validates:** `bunx tsc -b`; importable via `@secondlayer/subgraphs/schema` + `/validate`. changeset `@secondlayer/subgraphs` (minor — new public exports).
- [ ] **T1.2: Derive + lock the column-types resource.** In `mcp/src/resources.ts` build `COLUMN_TYPES` from `TYPE_MAP` entries (`{type, sqlType}`) + a hand `COLUMN_TYPE_DESCRIPTIONS` map keyed by `ColumnType`; keep the options block (nullable/indexed/search) separate. Add `@secondlayer/subgraphs` to mcp deps. **Same commit:** drift test in `resources.test.ts` — served `type` set === `Object.keys(TYPE_MAP)`, each served `sqlType` === `TYPE_MAP[type]`, descriptions cover every key. → **validates:** `bun test packages/mcp/src/resources.test.ts` (asserts `boolean`/`jsonb`/`timestamp` present, `sqlType:"NUMERIC"` for uint/int). changeset `@secondlayer/mcp` (patch).
- [ ] **T1.3: Correct + lock the filters resource to SubgraphFilter.** Rewrite `FILTERS_REFERENCE` to the real per-type fields (drop `contains`/`tokenId`/`event`; add `trait` where TraitScope applies; `contract_call:[contractId,functionName,caller,trait]`, `print_event:[contractId,topic,trait]`, etc.). **Same commit:** drift test — served type set === `VALID_FILTER_TYPES`; every advertised field ∈ `Object.keys(SubgraphFilterSchema._zod.def.shape)` (documented zod-internal access) so the resource can never advertise a `.strict()`-rejected field. → **validates:** `bun test packages/mcp`. (mcp changeset from T1.2 covers it.)
- [ ] **T1.4: Source CLI streams types from shared.** Replace the `VALID_TYPES` literal (`cli/src/commands/streams.ts:17-29`) with `STREAMS_EVENT_TYPES` from `@secondlayer/shared` (keep the sdk `StreamsEventType` *type* import). **Same commit:** drift test asserting `VALID_TYPES === STREAMS_EVENT_TYPES`. → **validates:** `bunx tsc`; `bun test`; `sl streams --types bogus` rejects. changeset `@secondlayer/cli` (patch).

**Release order:** publish `@secondlayer/subgraphs` (T1.1 exports) before mcp consumes it.

## Sprint 2 — Agent-native parity

**Goal.** An agent can produce ORM schemas (incl. Kysely) and consume a Streams window entirely over MCP. Demoable: `subgraphs_codegen`/`streams_consume` MCP tools + `sl … codegen --target kysely`.

- [ ] **T2.1: Add `generateKyselySchema`.** New `subgraphs/src/schema/kysely.ts` mirroring prisma/drizzle (lossless Numeric, nullable, per-table interface + `DB` registry); export from `subgraphs/src/index.ts`; unit test. → **validates:** `bun test packages/subgraphs`. changeset `@secondlayer/subgraphs` (minor).
- [ ] **T2.2: Wire CLI `codegen --target kysely`.** Remove the hard-reject branch + update `--target` help text (`cli/src/commands/subgraphs.ts:1111-1124`). → **validates:** `sl subgraphs codegen f.ts --target kysely` emits. changeset `@secondlayer/cli` (patch). *(dep: T2.1 published)*
- [ ] **T2.3: Add `subgraphs_codegen` MCP tool.** `{name|code, target:'prisma'|'drizzle'|'kysely', schemaName?}` in `mcp/src/tools/subgraphs.ts` calling the three generators. → **validates:** tool test returns a schema string per target. changeset `@secondlayer/mcp` (minor). *(dep: T2.1)*
- [ ] **T2.4: Add bounded `streams_consume` MCP tool.** Thin-wrap `streamsClient.events.list({cursor,limit})` (clamp `limit`, pass through `next_cursor`) in `mcp/src/tools/streams.ts`. → **validates:** tool test returns events + next_cursor, limit clamped. (mcp changeset from T2.3 covers it.)

**Release order:** subgraphs → cli/mcp.

## Sprint 3 — Image split (A2, ungated; per-service tags)

**Goal.** Each processor builds/deploys/rolls back as its own image — an api regression can't ground the data plane, and one service can be pinned/rolled back independently. Demoable: build/up a new-image service; roll back *only* that service.

- [ ] **T3.1: Dedicated Dockerfile targets.** Add `subgraph-processor`, `l2-decoder`, `subscription-processor` as thin `FROM api`/`FROM indexer` retags with baked `CMD` (no full rebuild). → **validates:** `docker build --target <t>` each.
- [ ] **T3.2: Point compose at new images + per-service tag vars.** Each service: `image: …-<svc>:${<SVC>_IMAGE_TAG:-${DEPLOY_IMAGE_TAG:-latest}}`, drop `command:`. → **validates:** `docker compose config --images` lists the 3 new images; local `up` of one reaches healthy/runs its CMD.
- [ ] **T3.3: Teach deploy/rollback the new services + per-service tags.** Add all 3 to `deploy.sh` `APP_SERVICES`/`_pull_services` and `rollback.sh` `APP_SERVICES` + pull line; thread the per-service `*_IMAGE_TAG` vars (default to `DEPLOY_IMAGE_TAG`) through both. → **validates:** deploy/rollback dry-run shows all 3 pulled + a single-service rollback pins only that image.
- [ ] **T3.4: CI build matrix.** Add the 3 targets to `deploy.yml:73` + `oss-images.yml:27` (thin retag builds). → **validates:** CI green.
- No changeset (infra).

## Sprint 4 — G9 portable Index schema emission

**Goal.** Emit typed ORM/JSON-Schema for the canonical Index domain from `SOURCE_READ_COLUMNS` — "type-safe Stacks data in your own stack, can't drift from the API."

- [ ] **T4.1: Index schema generator.** `shared` (or `subgraphs`) generator: `SOURCE_READ_COLUMNS` → Prisma/Drizzle/JSON-Schema models (lossless types). Unit test vs registry. → **validates:** `bun test`. changeset.
- [ ] **T4.2: CLI surface.** `sl index codegen --target prisma|drizzle|kysely|json-schema [--object <name>]`. → **validates:** emits per target. changeset cli.
- [ ] **T4.3: MCP surface.** `index_codegen` tool calling the generator. → **validates:** tool test. changeset mcp.

## Opportunistic ergonomics (Tier C — backlog; pkg/≈commits)

- **Streams (api):** drop `from_block` from retention + migrate `routes.test.ts:197-208`→`from_height` (1); advertise `oldest_seekable_height`/`oldest_cursor` in `/tip`+`/usage` from `getStreamsRetentionCutoff` (1); enrich retention 403 body `code:'RETENTION'`+`dumps_manifest_url` — needs structured field on `AuthorizationError` (1-2).
- **Subgraphs (subgraphs+api+sdk):** `/:table/aggregate` REST + `client.aggregate()` (2-3, +sdk changeset); one shared per-table DDL emitter incl. UNIQUE/idx/FK/defaults (2); emit BYO breaking-change migration via `diffSchema`/`renderDeployPlan` (2); bound `?since` SSE replay — seed `_id` from `MIN(_id) WHERE _block_height>=since` or add `(_block_height,_id)` index (1).
- **Index (api):** wire `resolveTraitContractIds` into `INDEX_EVENT_CONFIG`/contract-calls (2); `LEFT JOIN blocks` for block_time/burn_block_height (1); opaque mempool cursor envelope + doc (1-2).
- **Subscriptions (api+sdk+mcp):** `POST /:id/test` via `buildForFormat` logging a delivery row + SDK/MCP surface (2-3); export+document `ApplyEnvelope`/`RollbackEnvelope` from **sdk** (1, +sdk changeset).
- **Residual:** `processors-depend-on-api` DB-tap fallback (auto-fallback to `SUBGRAPH_SOURCE`-unset path on api unavailability) — low value post-P0-2 N>1 replicas.

---

## Unresolved questions

1. **Per-service tag var naming** — `SUBGRAPH_PROCESSOR_IMAGE_TAG` etc., or a generic indirection? (cosmetic; will default to `DEPLOY_IMAGE_TAG`.)
2. **G9 generator home** — `shared` (alongside `SOURCE_READ_COLUMNS`) vs `subgraphs` (alongside prisma/drizzle emitters)? Leaning `subgraphs` to reuse the emitters.
3. **Tier C sequencing** — batch-release per package, or fold into the next scheduled release?

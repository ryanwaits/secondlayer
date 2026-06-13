# Service Positioning Audit — Streams / Index / Subgraphs
2026-06-12 · ultracode 13-agent run (3 code ground-truth readers, 4 messaging auditors, gap synthesis, adversarial honesty check, 3 reframe proposals + judge)

## TL;DR

**Founder frame ("everything = indexing; Streams = lower-level, Index = higher-level app indexing, Subgraphs = define-function → hosted tables/API") is 2/3 true today.** Streams and Subgraphs survive adversarial reading against the code. Index does not — yet:

- Index ships a real **build-your-own-index parts kit** (resumable cursors + `reorgs[]` on every envelope, `from_height=0` backfill, `/canonical`, SDK `walk()`, drift-tested `sl index codegen` for Prisma/Kysely/Drizzle, print-schema inference, inclusion proofs) — but **zero docs examples ever write anything**, the one `walk()` example has an empty body, and the SDK has **no checkpointed consumer for Index** (consume/onReorg/rewind exist only in the Streams SDK).
- The structural root cause is canon: `STRATEGY.md:60` assigns "building your own indexer" **exclusively to Streams**, foreclosing the middle path the code most heavily invests in (build on decoded rows without writing decoders). Every downstream surface inherited it — including the docs-landing "Which API?" copy that started this audit.
- The index-api marketing page **contradicts its own hero demo**: the code example builds an indexer (walk → insert into your own Kysely table) under "you query" copy and a "Start querying" CTA.
- Worst factual bugs found (agent surfaces): skill calls Streams "pre-alpha, internal-only" (it's live in prod w/ x402 + public dumps); MCP README claims dumps need an API key (code-verified false — public).
- Honest Index frame is a **two-sided pair**: *we run the chain indexer; you build your app index on decoded rows.* "Index = app indexing" as a managed service would be selling Subgraphs with Index's name on it — never claim managed mirroring for Index.
- Frame becomes fully sellable after one small gating build: port the Streams consumer contract to `sl.index` (`index.events.consume()` w/ checkpoint commit + auto reorg rewind; `streams/consumer.ts` is the spec).

Honest one-liners (code-derived):
- **Index** — cursor-paginated, reorg-annotated REST API over our decoded tables, plus the parts kit (walk/codegen/canonical/proofs) to build and verify your own app index; you bring the database and the loop.
- **Streams** — cursor-resumable, signed firehose of raw normalized events + parquet dumps; the pull-and-replay plumbing for building an indexer from zero (at-least-once, client-owned checkpoints).
- **Subgraphs** — one TypeScript function over decoded events, run by us as a managed indexer: hosted/BYO Postgres tables, instant REST API, SSE, webhooks, backfill, reorg handling. REST, not GraphQL.

---

# Truth vs Claims Gap — Secondlayer Positioning Audit Synthesis

Spot-checks performed: `STRATEGY.md:60` (one-liner confirmed verbatim), `packages/mcp/src/tools/streams.ts:15` (dumps need `SL_STREAMS_DUMPS_URL` config, **not** an API key), `packages/sdk/README.md:28` ("dumps need no key"). Code wins: **dumps are public; MCP README's key claim is wrong.**

---

## Index — the wedge with a split personality

### 1. What the code says it is
A cursor-paginated, reorg-annotated REST read API over Secondlayer's decoded tables **plus a genuine build-your-own-index parts kit**: SDK `walk()` iterators, `sl index codegen` (drift-tested Prisma/Kysely/Drizzle/JSON-Schema for a BYO mirror DB), print-schema inference, trait scoping, `/canonical` map, `reorgs[]` on every envelope, `from_height=0` backfill windows, tx-inclusion proofs. You bring the database and run the sync loop; managed custom indexing is Subgraphs.

### 2. What we currently tell people
"We run the indexer, you query." Index is defined on every surface by the read half only: docs landing routes "**Querying chain data? Use Index**" (`docs/page.mdx:10`), surface card says "we run the indexer, **you query**" (`surface-cards.tsx:20`), the index-api page says "We run the decoder, **you query**" with a "**Start querying**" CTA (`index-api/page.tsx:81-89`), SDK mental model says "`sl.index` **reads** the decoded layer" (`sdk/README.md:38`).

### 3. Specific contradictions
- **Code**: `sl index codegen` emits "a typed schema for a BYO database that mirrors Index rows" (`subgraphs/src/schema/index-codegen.ts`), `/canonical` exists "so a client can sync only the canonical chain" (`routes/index.ts:233`). **Copy**: docs assign "**Building your own indexer? Use Streams** — the inputs, not our decoding" (`docs/page.mdx:10`, canonized at `STRATEGY.md:60`). The middle path the code explicitly builds — custom indexer on **decoded** data, no decoders written — is foreclosed by the canon one-liner.
- **Marketing hero vs product copy**: homepage sells "Index the chain, own your API" (`page.tsx:12`), then Index's only homepage headline is "Decoded events, no key required" (`home-sections.tsx:61`) — a free read API, not the substrate of the hero promise. The index-api hero code example (`INDEXER_CODE`, walk → insert into your own Kysely `sales` table) literally builds an indexer, while sitting under "you query" copy and a "Start querying" CTA. The page contradicts its own demo.
- **STRATEGY.md vs itself**: `:18` says "indexer-as-a-service" and the load-bearing table (`:52-58`) assigns "Run the indexer for you" / "Query over REST" as a **pair**; `:60` collapses to "querying? Index" — the one half got shipped everywhere.

### 4. Flatly unsupported claims
- None factually false about Index itself, but "**you query**" as the *complete* user role is contradicted by ~half the shipped surface area (codegen, walk, canonical, proofs, print-schema exist for builders).
- `index-api/page.tsx:81` "decoded **read layer**" and `docs/index/page.mdx:3` same — brushes the no-layer-terminology ruling.
- Subtle trap nowhere disclaimed prominently: default query window is **last ~1 day** unless cursor/`from_height` is passed — "every transfer… filter and page" copy implies full history on a naive call.

### 5. Missing examples for the claimed job
Zero Index examples write anything, anywhere in docs:
- No cursor-sweep ingest loop (walk + persist + checkpoint) — the only checkpointed consume example in all docs is Streams-only (`sdk/page.mdx:138`).
- `/canonical` sync claim (`docs/index/page.mdx:103`) and reorg reconciliation algorithm (`:145`) are prose-only; SDK contributes only the `IndexReorg` type.
- The single `walk()` example has an **empty body** (`docs/index/page.mdx:155`).
- No backfill-then-tail seam, no `sl index codegen` demo, no print-schema → typed own-ingest path (always redirected to Subgraphs scaffold).

---

## Streams — best-aligned product, sabotaged by the agent skill

### 1. What the code says it is
Cursor-resumable raw-event firehose (11 fixed types, raw payloads, canonical-only), SSE tail that is a **1.5s poll loop** (not push), ed25519-signed responses, public signed parquet dumps on R2 with `replay()` dumps→live seam, SDK consumer with auto reorg-rewind and `finalizedOnly`. At-least-once, client-owned checkpoints. Retention 7/30/90d by tier.

### 2. What we currently tell people
Mostly right: "raw signed event firehose + dumps — for building your own indexer" (`surface-cards.tsx:36`, `STRATEGY.md:26-29`, streams page, SDK consume docs).

### 3. Specific contradictions
- **Skill vs everything**: `SKILL.md:38` calls Streams "**pre-alpha, internal-only firehose**" while root README sells "consume the raw signed event firehose + parquet dumps to build your own" and llms.txt lists it as a public product with x402 reads. An agent entering via the skill will never recommend Streams. This is the single worst factual contradiction in the audit.
- **Dumps auth three-way split**: MCP README:17 "`streams_dumps` **requires an `SL_API_KEY`**" vs SDK README:28 "need **no** key" vs skill:304 "dumps are public." **Code verdict: public; MCP tool needs only `SL_STREAMS_DUMPS_URL` config. MCP README is wrong.**
- **"Tail the tip" / realtime implication** vs code: SSE = 1.5s server-side poll + 2-block tip clamp; latency floor is seconds. Copy never claims milliseconds outright, so this is a soft gap, not a lie.

### 4. Flatly unsupported claims
- MCP README's key requirement for dumps (false).
- Skill's "internal-only / bearer required pre-alpha" status (false per prod: x402 rail live, free-key reads, public dumps).
- "Never miss an event" (`docs/streams/page.mdx:5`) is true only with correct client checkpointing and within tier retention — unqualified as written.

### 5. Missing examples
- Skill has zero build-your-own-indexer examples (consume/replay/dumps) — only bearer QA curls.
- No parquet + DuckDB example anywhere despite dumps being "the defensible external feature" (focus-audit:189).
- No full `sl streams pull` invocation/output in strategy-level docs.

---

## Subgraphs — copy matches code; the gaps are name and omissions

### 1. What the code says it is
A managed Postgres-backed custom indexer: one `defineSubgraph()` file → server-bundled, DDL provisioned (managed or BYO Postgres), processor replays history then follows tip, auto REST API per table + aggregates + SSE tail + transactional-outbox webhooks. **REST only — zero GraphQL.** Handlers not security-sandboxed; no cross-table joins via API; no time-travel; x402 anon deploys are forward-only 7-day-TTL.

### 2. What we currently tell people
"Your own indexer, minus the node" / "your schema on our indexer" — consistently indexing-framed across marketing, docs, STRATEGY.md. This is the healthiest product narrative.

### 3. Specific contradictions
- **The name**: "Subgraphs" imports The Graph's GraphQL connotation; code has zero GraphQL. No copy anywhere preempts "where's my GraphQL endpoint?" — a predictable first-session disappointment. (Renaming likely off-table; a "REST, not GraphQL" disclaimer is the cheap fix and already appears in the honest one-liner, just not in shipped copy.)
- **SDK mental model inverts the frame**: `sdk/README.md:42` "`sl.subgraphs` **reads** app-specific tables" — deploy appears ~280 lines later. The monetization core is taught as a read surface in the doc's own "Mental model" section.
- **MCP README** calls the company a "**subgraph platform**" (`mcp/README.md:3`), collapsing the 3-product canon and contradicting root README's "hosted indexer."
- **llms.txt** shows only the $2 x402 deploy path — an agent with an account learns no keyed/CLI deploy route.

### 4. Flatly unsupported claims
- "Live from the moment you deploy, full genesis history on paid plans" is supported; but homepage "redeploy and it reindexes for you" (`subgraphs/page.tsx:223`) glosses over: BYO breaking deploys are **refused** (422 + migration plan), and tip-first backfill refuses non-replay-safe handlers — "it reindexes for you" is conditional.
- Per-topic `prints` typing is type-level only, not runtime-validated (`types.ts:197-199`) — typed-tables copy slightly overstates.

### 5. Missing examples
- `defineSubgraph()` contents absent from all four strategy/audit docs that hinge on it.
- No deploy output showing the public curl URL (load-bearing in both golden-path descriptions).
- No genesis-backfill demo despite it being the marquee paid feature on pricing.

---

## Cross-cutting

- **Pricing frames the business as an RPC gateway**: req/s headlines (`pricing/page.tsx:27`), "Mint a key… you're querying in seconds" (`:76`), while the most indexing-native monetization line ("Priority indexing for your contracts") is buried in the enterprise footnote. The 2026-06-12 audit already conceded Index reads are legitimately rate-tier-shaped — the fix is lead order, not the ladder.
- **Taxonomy fragmentation by entry point**: llms.txt = Streams/Index/Subgraphs/Subscriptions; skill = Datasets-first five-product list; MCP README = "subgraph platform"; SDK README = "Stacks Streams/Index/Subgraphs" naming + "Second Layer" two-word brand. Four taxonomies, three brand spellings.
- **"Layer" leakage**: "indexing layer" (llms.txt:1, homepage), "read layer" (index pages), "delivery layer" (home-sections:99) — all adjacent to the banned L1/L2/L3 vocabulary; sanctioned replacement is the raw/decoded/your-schema triad (llms.txt:3-4 is the cleanest statement in the codebase).
- **The missing middle path is the structural root cause**: the canon one-liner (`STRATEGY.md:60`) makes "build your own indexer" Streams-exclusive, erasing the path the code most heavily invests in — build on **decoded** Index data (walk + codegen + canonical + reorgs) without writing decoders. Every downstream surface inherited this.

---

## Top 10 fixes, ranked by positioning-clarity impact

1. **Amend the STRATEGY.md:60 one-liner to restore the middle path** (canon wins over everything per STRATEGY.md:5; nothing downstream can be fixed coherently first). E.g.: *"Querying decoded data? Index. Building your own index on decoded data? Index + walk/codegen. Want your schema hosted? Subgraphs. Want the raw inputs? Streams."* Keep the we-index/you-query pair from `:52-58` intact.
2. **Fix the skill's Streams status** (`SKILL.md:38,:247`): delete "pre-alpha, internal-only," document free-key reads + public dumps + consume/replay. Highest-severity factual error; agents entering via skill currently get an anti-recommendation for a marketed product.
3. **Fix MCP README dumps-key claim** (`mcp/README.md:17`): code-verified false — dumps need a base URL config, no key. Also replace "subgraph platform" identity with the hosted-indexer + 3-product frame.
4. **Ship the Index ingest-loop example** (walk + persist + checkpoint + `reorgs[]` rollback + `/canonical` reconcile) on `docs/index/page.mdx` and SDK README. One example retires four prose-only claims and gives the wedge its first written-not-just-read demo. Fill the empty `walk()` body while there.
5. **Re-CTA and re-lede the index-api page**: "Start querying" → "Start indexing" / "Build your indexer"; rewrite "the decoded read layer… you query" (`:81-84`) to the two-sided frame ("we run the decoder; build on the rows or just read them"). The hero demo already matches — only the copy fights it.
6. **Reorder pricing around indexing capacity**: lead Pro with subgraph slots + genesis backfill + private subgraphs; req/s becomes a line item; promote "priority indexing for your contracts" out of the footnote. No tier/number changes (locked Free/Pro $99/Ent).
7. **Unify the taxonomy across agent surfaces** (skill, llms.txt, MCP README, SDK README): one product list (Index/Subgraphs/Streams + Subscriptions-as-feature), one brand spelling ("Secondlayer"), kill the "Stacks Streams/Index/Subgraphs" third naming scheme, and either canonize Datasets' place or remove it from the skill's product framing.
8. **Rewrite the SDK "Mental model"** (`sdk/README.md:37-42`): Subgraphs = "deploy your own indexer, then read your tables" with a top-of-README deploy snippet; Index = "decoded rows + the walk/codegen kit"; stop teaching all three as "reads X from Y."
9. **Purge "layer" from shipped copy** (llms.txt "indexing layer," index pages "read layer," home-sections "delivery layer"): substitute the sanctioned raw/decoded/your-schema triad; promote llms.txt:3-4's clean formulation as the template line everywhere.
10. **Add the graduation-path demo + REST-not-GraphQL disclaimer**: one homepage/docs sequence showing Index walk loop → "this loop is a subgraph" → same table via `defineSubgraph()` (proves the products compose, which the hero promises), and one sentence on the Subgraphs page preempting the GraphQL expectation its name creates.

Files most implicated: `STRATEGY.md`, `~/.claude/skills/secondlayer-api/SKILL.md`, `packages/mcp/README.md`, `apps/web/src/app/(www)/docs/page.mdx` + `surface-cards.tsx` + `docs/index/page.mdx`, `apps/web/src/app/(www)/index-api/page.tsx`, `apps/web/src/app/(www)/pricing/page.tsx`, `packages/sdk/README.md`, `apps/web/src/app/llms.txt/route.ts`.

---

# Adversarial honesty check: "everything = indexing" frame vs code reality

## Verdict

The frame is **2/3 true today, 1/3 overreach**. Streams and Subgraphs survive adversarial reading intact. Index does not — as built and documented, Index is a decoded read API with an indexing **parts kit** bolted on, and the one artifact that would make "app indexing" literally true (a checkpointed Index ingest loop) does not exist in the SDK, the docs, or anywhere else. The frame is *reachable* — mostly with repositioning plus one small SDK build — but selling it verbatim today would be selling Streams' product story with Index's name on it.

## Where the frame holds (no refutation found)

- **Streams = lower-level indexing: TRUE, fully code-backed.** `consumeStreamsEvents` is a real checkpointed consumer with automatic rewind-to-fork-point (`packages/sdk/src/streams/consumer.ts:119-150`, verified: sorts fresh reorgs, rewinds cursor to lowest `fork_point_height`, re-reads), plus `events.replay()` dumps→live seam, signed manifests, finalizedOnly mode. This is genuine build-your-own-indexer plumbing.
- **Subgraphs = define-function → hosted tables/API: TRUE.** Bundle-on-deploy, DDL provisioning, backfill/reindex/gaps lifecycle, reorg rewind, outbox webhooks, BYO Postgres. The only honesty caveat is the *name* (no GraphQL anywhere despite The Graph connotation) — a naming risk, not a frame falsehood.
- **"NOT a hosted querying service" as aspiration:** defensible for Subgraphs and Streams, where the unit of value really is indexing work (the 2026-06-12 pricing audit agrees: Subgraphs' marginal cost is slots/rows/backfill).

## Where the frame overreaches: Index as "app indexing"

1. **The canonical app-indexing loop does not exist on Index.** Verified `packages/sdk/src/index-api/client.ts`: `walk()` exists (auto-pagination, :588-701) but there is **zero** `consume`, checkpoint contract, `onReorg`, rewind, or finalizedOnly logic — `reorgs` appears only as a passive typed field on envelopes. Every ingest-correctness primitive the frame implies lives exclusively in the Streams consumer. "App indexing on Index" today means hand-rolling what the Streams SDK gives you for free.
2. **Reorg handling on Index is prose plus a type.** The API returns `reorgs[]` and `/canonical`, but reconciliation ("roll back rows in orphaned_range, re-fetch from new_canonical_tip", docs/index/page.mdx:145) has no code anywhere — not docs, not SDK helper. The hardest indexing problem is unaddressed in the wedge product.
3. **The company's own canon refutes the frame.** STRATEGY.md:60 (verified): *"querying? Index. Building your own indexer? Streams."* — and STRATEGY.md declares itself the doc that wins conflicts. The Index marketing page self-defines as "the decoded read layer… you query" with a **"Start querying"** CTA (index-api/page.tsx:82-88, verified) directly under a hero code example that literally builds an indexer. The frame can't ship without amending canon, not just copy.
4. **100% of Index examples are one-shot reads.** The single `walk()` example in docs has an empty body. Nothing on any surface shows Index feeding a persisted store.
5. **Naive Index usage is query-shaped by design.** Verified `packages/api/src/index/_shared.ts`: no cursor/from_height → default window is last ~1 day (`tip - STREAMS_BLOCKS_PER_DAY`). Backfill is opt-in knowledge.
6. **Economics agree with the refutation.** The company's own pricing audit (2026-06-12) concedes Index reads are legitimately query-shaped (~$0 marginal cost, rate-tier SaaS "actually fine here"). "Everything = indexing" applied to the pricing page would be the dishonest direction.

**However** — the parts kit is real and substantial: resumable `<height>:<index>` cursors on every envelope, `from_height=0` backfill windows, `reorgs[]` + `/canonical`, `walk()`, drift-tested `sl index codegen` (prisma/kysely/drizzle/json-schema — verified `packages/subgraphs/src/schema/index-codegen.ts` exists), empirical print-schema, inclusion proofs, immutable ETag caching. The **honest** frame for Index is: *"we decode and run the chain indexer; you build your app index on decoded events"* — a two-sided pair, not "Index = app indexing" as a managed service. The managed version of app indexing already has a name: Subgraphs.

## Spot-checks where reports conflict (all verified)

| Claim | Reality | Verdict |
|---|---|---|
| MCP README:17 "`streams_dumps` requires an `SL_API_KEY`" | Manifest served at `app.get("/public/streams/dumps/manifest")` — anon route, `packages/api/src/routes/status.ts:300`; SDK README:27 and skill both say public | **MCP README factually wrong**; fix it |
| Skill SKILL.md:38 Streams = "pre-alpha, internal-only firehose" | README/llms.txt sell Streams publicly; x402 rail live in prod; dumps anon | **Skill factually stale**; agents reading it won't recommend a shipped product |
| "Index has indexing primitives in SDK" vs "Index is read-only" | Both half-true: `walk()` yes; consume/checkpoint/reorg-rewind no | Frame-critical gap confirmed |
| Streams consumer reorg auto-rewind | Confirmed at consumer.ts (rewind to lowest fork point, dedup handled reorgs) | Streams claims honest |

## Minimum work to make the frame TRUE

**Reposition with existing capabilities (no code-building):**
1. Amend STRATEGY.md:60 one-liner — it's canon and currently assigns "building your own indexer" exclusively to Streams. New shape: *raw indexing? Streams. App indexing on decoded events? Index. Your schema, zero ops? Subgraphs.*
2. Index docs: add the cursor-sweep ingest loop example (`walk()` → persist → checkpoint cursor → on `reorgs[]` roll back + re-fetch). All API capability exists; only the example is missing. This single example is the highest-leverage item in the entire repositioning.
3. Add canonical-sync and reorg-reconciliation **code** for the existing prose (docs/index/page.mdx:103, :145).
4. Index page copy: kill "read layer / you query / Start querying"; keep the existing hero code (track-sales.ts already demos the frame). Also purge "layer" nouns ("decoded read layer", "indexing layer for Stacks", "delivery layer") per founder ruling.
5. Fix agent-surface falsehoods: skill's "pre-alpha internal-only" Streams, MCP README's dumps-key claim and "subgraph platform" identity, SDK README "Mental model" (teaches all three as read surfaces).
6. Pricing copy reorder within locked Free/Pro $99/Ent: lead with indexing goods (subgraph slots, genesis backfill, priority indexing), demote req/s to a line item.

**Requires building (frame is aspirational without it):**
1. **`sl.index` checkpointed consumer** — port the Streams consumer contract (onBatch cursor-commit, onReorg rewind via `reorgs[]`/`Cursor.atHeight(fork_point)`, finalizedOnly) onto Index events/contract-calls. Small, well-templated build (consumer.ts is the spec). Without it, "app indexing on Index" has no canonical loop and the docs example in (2) above must be hand-rolled code — honest but weak.
2. Optional, medium: `sl index sync` scaffold (codegen schema + walk loop + checkpoint table) — turns the parts kit into a 1-command start; closes the gap with "no backfill scripts" messaging.
3. **Do not claim** managed mirroring/"we run your app index" for Index — that is a new product, and today its honest name is Subgraphs. The frame must keep the two-sided split: *we run the chain indexer / you run (or we host) the app index.*

**Net:** founder frame is sellable as *"raw indexing (Streams) → app indexing on decoded data (Index) → hosted indexing (Subgraphs)"* only after item B1 (Index consumer) plus the docs loop example; everything else is repositioning. Selling it before B1 is marketing a loop that no SDK can run.

---

# Final positioning — synthesis

**Base: Proposal 3 (show-don't-tell).** Positioning is carried by one flagship runnable artifact per service, so copy can never outrun code. Merged in: Proposal 2's job-first "Which API?" decision tree and the verbatim disambiguation rule, Proposal 1's canon-first sequencing and phase-gating.

**The one rule, repeated verbatim everywhere:** *we run the chain indexer; you run the loop (Index) or we run the loop (Subgraphs) or you build the whole thing from raw inputs (Streams).* Vocabulary: **raw / decoded / your-schema** only. The words "layer," L1/L2/L3, "altitude," and "pipeline" never ship in copy.

## Per-service one-liners

- **Index** — Decoded Stacks data we keep indexed for you: every transfer, contract call, and print event as typed rows with resume cursors and `reorgs[]` on every page. Query it keyless in one curl — or build your app's own index on it. We run the decoder; you bring the database and the loop.
- **Subgraphs** — Your indexer, run by us: one TypeScript file (sources, schema, handlers) deploys to hosted Postgres tables behind an instant public REST API — backfill, reorg handling, and webhooks included. REST, not GraphQL.
- **Streams** — The raw event record of Stacks: a signed, cursor-resumable firehose with parquet dumps, replay from genesis, and a checkpointed consumer that auto-rewinds on reorgs. The inputs for building an indexer from zero.
- **Subscriptions** (feature, not product) — The push channel for Index and Subgraphs: webhooks on chain events or your tables, so you're pushed instead of polling.

## "Which API?" replacement copy

> ## Which API?
>
> Everything here is indexing — the question is how much of the indexer you want to run.
>
> **Need answers from chain data right now?** Use **Index**. We run the chain indexer and the decoder; `curl 'https://api.secondlayer.tools/v1/index/events?event_type=ft_transfer&limit=5'` returns typed, decoded JSON in ten seconds, keyless. Every page carries a resume cursor, the chain tip, and any overlapping `reorgs[]`.
>
> **Building your app's own index?** Still **Index** — the same rows are built to be swept, not just read. `walk()` follows cursors, `from_height=0` backfills history, `reorgs[]` tells you exactly which rows to roll back, and `sl index codegen` emits your mirror schema. You bring the database and run the loop; we keep the decoded data flowing. No decoders to write, no node to run.
>
> **Want your own tables with zero ops?** Use **Subgraphs** — one TypeScript file deploys to hosted Postgres tables behind the same public `/v1` API. We run the backfill, the sync loop, and the reorg handling. REST, not GraphQL. The Index loop above, hosted.
>
> **Building from the raw inputs?** Use **Streams** — the signed raw event firehose with parquet dumps, `replay({ from: "genesis" })`, and a checkpointed consumer with automatic reorg rewind. For data engineers who want the inputs, not our decoding.
>
> Raw events (Streams), decoded rows (Index), your own tables (Subgraphs) — and **Subscriptions** pushes any of it to a webhook.

## Execution plan

### Phase 0 — canon (founder sign-off, blocks everything)
1. **STRATEGY.md:60** amend the one-liner: *"Reading decoded data? Index. Building your own index on decoded rows? Also Index — walk + cursors + reorgs[]. Your schema hosted? Subgraphs. Raw inputs? Streams."* Keep the :52–58 we-do/you-do table; add "Or: build on the rows" under "You do".
2. Founder rulings needed: (a) frozen-periphery exception for `sl index codegen` (kysely target only) in the Index flagship; (b) Streams nav prominence vs 2-product taxonomy; (c) green-light for the `sl.index` consume() build.

### Phase 1 — reword now (truthful today, no code dependency)
3. **Agent-surface factual bugs (same sweep, highest severity):** `~/.claude/skills/secondlayer-api/SKILL.md` delete "pre-alpha, internal-only" Streams (:38, :247), add consume/replay/dumps examples; `packages/mcp/README.md` fix false dumps-key claim (:17 — dumps are public, tool needs `SL_STREAMS_DUMPS_URL` only) and replace "subgraph platform" (:3) with hosted-indexer frame; `packages/sdk/README.md` rewrite Mental model (:37–42) as jobs not reads, deploy snippet to top, "Second Layer" → "Secondlayer"; `apps/web/src/app/llms.txt/route.ts` "indexing layer" → "the hosted indexer for Stacks", add keyed/CLI deploy path, keep its raw/decoded/your-schema line as the template.
4. **Docs landing:** `docs/page.mdx` swap in the Which API copy above + job-first lede; `docs/surface-cards.tsx` Index card → "read them keyless, or build your index on them"; Streams card unchanged; concept budget holds (codegen/canonical stay off the landing).
5. **`docs/index/page.mdx`:** split into "Query it" / "Build your index on it"; hand-rolled ingest loop labeled "the loop, spelled out — you bring the database"; fill empty `walk()` body (:155); turn the three prose-only claims (:103 canonical sync, :127, :145 rollback) into code; default ~1-day-window callout at the first curl; print-schema → typed own-ingest path alongside the Subgraphs handoff; kill "decoded read layer".
6. **Marketing layer-purge + reframe:** `index-api/page.tsx` — lede :81–84 → two-sided pair, CTA "Start querying" → "Start indexing", "One layer. Three ways in." → "One surface. Three ways in.", closing → "Stop writing decoders. Start indexing."; `home-sections.tsx` — Index headline → **"Decoded chain data, kept indexed"** (P2's version — not P3's "Build your indexer…", which overclaims pre-consumer), "delivery layer" → "push channel"; `home-snippets.ts` INDEX_SNIPPET → 6-line walk-and-persist mini loop; `streams/page.tsx` "the layer you'd run a node for" → "what you'd run a node for"; homepage sub "indexing layer" → "hosted indexer"; **sweep the unpushed OG-card text for the same phrase**.
7. **Subgraphs honesty:** REST-not-GraphQL sentence near hero; soften "redeploy and it reindexes for you" (:223) — BYO breaking deploys get a migration plan; graduation cross-link to/from Index page.
8. **Pricing reorder, zero number changes** (Free/Pro $99/Ent locked): Pro leads private subgraphs → genesis backfill → webhook scale; "250 req/s" demoted to line item; "Priority indexing for your contracts" promoted into Enterprise card; "you're querying in seconds" → "you're indexing in minutes." Do NOT overreach: Index reads stay rate-tier-shaped per the 2026-06-12 audit.
9. **Streams docs:** promote consume-with-checkpoint + replay seam from SDK README into the page; qualify "never miss an event" ("with a committed cursor, within tier retention").

### Phase 2 — build, then claim
10. **`sl.index` consume() port** (gating build, small — `packages/sdk/src/streams/consumer.ts` is the spec): `index.events.consume()` / `contractCalls.consume()` with onBatch cursor-commit, auto-rewind via `reorgs[]` + fork-point cursor, finalizedOnly. Until this lands, no copy stronger than "you bring the loop."
11. **Index flagship `sales-index/`** (~50 lines, per P3 spec): codegen'd kysely schema + checkpoints table → walk from height 0 → upsert + persist cursor atomically → reorg DELETE + re-sweep → `/canonical` reconcile on startup → tail. Ships on docs/index, index-api hero (third `checkpoint.ts` tab), SDK README, skill. Collapses to ~12 lines once consume() exists.
12. **Graduation demo:** the same sales table as `defineSubgraph()`, with REAL `sl subgraphs deploy` output printing the public curl URL (never rendered anywhere today), then webhook attach. This is the anti-cannibalization device: every Index loop example ends "this loop is a subgraph — one file, zero ops."
13. **Genesis backfill demo** (`sl subgraphs backfill`, blocks_behind draining, replay-safe-handler note) — the marquee $99 feature, currently demonstrated nowhere.
14. **Streams flagship + DuckDB sidebar:** `indexer-from-zero.ts` (replay genesis → live seam → checkpointed consumer) and `sl streams pull` → DuckDB over parquet — dumps' first usage example anywhere.

### Standing guardrails
- Never claim managed mirroring for Index — that product's name is Subgraphs.
- "Backfill" copy ships with the default-window callout in the same commit.
- Loop nouns (checkpoint, reorg rollback) stay off the homepage golden path (5-concept budget).
- Pair vocabulary enforced: **chain indexer (ours) / app index (yours)** — never bare "indexer" in adjacent sentences.

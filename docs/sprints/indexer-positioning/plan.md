# Indexer positioning — execution plan

2026-06-12. Source: `docs/audits/service-positioning-audit-2026-06-12.md`. Founder ruling: Streams + Index are BOTH indexer products — Streams = raw low-level indexers, Index = app-level indexers, Subgraphs = hosted (define a function → tables/API). "Index = app indexing" must be made TRUE, not just claimed. Skill (`secondlayer-api`) known-outdated, out of scope here.

**One rule, verbatim on every surface:** we run the chain indexer; you run the loop (Index), or we run the loop (Subgraphs), or you build the whole thing from raw inputs (Streams). Vocab: raw / decoded / your-schema. Pair vocab: chain indexer (ours) / app index (yours). Subgraphs: "REST, not GraphQL". Never claim managed mirroring for Index.

**Composition story (founder ruling, code-verified TRUE):** Streams POWERS Index — our decoder pipeline is itself a Streams consumer (`packages/indexer/src/l2/decoder.ts` consumes the raw firehose → writes decoded_events); Subgraphs runs on Streams (clock) + Index (decoded data) via the `BlockSource` seam. Marketing line this earns: "Index is built on Streams — the same firehose you can consume. Subgraphs is built on Index — the same rows you can sweep. We sell the primitives we build on." Every product page states what powers it and what it powers.

## Feature-gap register (what keeps the frame from being true)

| Gap | Severity | Disposition |
|---|---|---|
| No checkpointed consumer on Index SDK (consume/onReorg/rewind = Streams-only; `walk()` has no checkpoint contract) | BLOCKING the frame | Sprint 2 build — `streams/consumer.ts` is the spec |
| Zero Index examples that write anything; `walk()` docs example body empty | BLOCKING the story | Sprint 1 (hand-rolled loop) → Sprint 3 (flagship) |
| Reorg reconciliation = prose + type only (`docs/index/page.mdx:145`, `IndexReorg`) | High | Code in Sprint 1 docs; automated inside consume() in Sprint 2 |
| Default query window = last ~1 day without cursor/from_height (`_shared.ts:124-139`) — naive use is query-shaped | Medium | Docs callout Sprint 1; `fromHeight: 0` ergonomic in consume() Sprint 2 |
| Cursor keyspaces differ: events `<height>:<event_index>` vs txs/calls `<height>:<tx_index>` | Low | Document; separate consume() fetchers |
| `sl index sync` scaffold (codegen schema + loop + checkpoint table, 1 command) | Optional | Deferred — needs founder call vs cli local-dev freeze |
| Streams: no build gaps found (consumer, replay seam, signed dumps all real) | — | Examples only (Sprint 3) |
| No push on Index itself | Not a gap | Position Subscriptions as "the push channel" |

## Sprint 1 — Canon + truthful rewording — DONE 2026-06-12 (626234dd..1fa10ae7, QA gate green) (no code build; demoable: site/docs tell the two-indexer story without overclaiming)

- [x] T1: `STRATEGY.md:60` amend one-liner → "Reading decoded data? Index. Building your own app index on decoded rows? Also Index — walk + cursors + reorgs[]. Your schema hosted? Subgraphs. Raw inputs? Streams." Add "Or: build on the rows" to :52-58 we-do/you-do table → validates: founder-approved wording, grep
- [x] T2: `docs/page.mdx` swap in new "Which API?" copy (jobs-first: answers now / building your app's index / your tables zero-ops / raw inputs) + `surface-cards.tsx` Index card → "read them keyless, or build your index on them" → validates: page renders, www smoke
- [x] T3: `docs/index/page.mdx` restructure into "Query it" / "Build your index on it"; fill empty `walk()` body (:155) with hand-rolled ingest loop (walk → upsert → persist cursor → on `reorgs[]` delete orphaned range + re-fetch), labeled "you bring the database"; turn `/canonical` sync (:103) + reorg reconciliation (:145) prose into code; default ~1-day-window callout at first curl; print-schema → typed own-ingest section alongside Subgraphs handoff; kill "decoded read layer" → validates: extracted snippets pass `bunx tsc --noEmit`, page renders. (Largest task; print-schema section may split to own commit.)
- [x] T4 (dep: T3 — CTA links /docs/index, which must show the loop first): `index-api/page.tsx` — lede :81-85 → two-sided pair ("we run the decoder; build on the rows or just read them"), CTA "Start querying" (:88) → "Start indexing", "One layer. Three ways in." (:120) → "One surface. Three ways in.", closing → "Stop writing decoders. Start indexing." → validates: visual + copy grep
- [x] T5: `components/home/home-sections.tsx` Index headline → "Decoded chain data, kept indexed" (NOT "build your indexer" — overclaims pre-consume()); `lib/home-snippets.ts` INDEX_SNIPPET (:25) → 6-line walk-and-persist mini loop; "delivery layer" → "push channel"; present Index + Streams as the two build paths (app index on decoded rows / raw indexer from inputs). SAME COMMIT: rewrite `lib/home-snippets.test.ts` compile-checked twin + content assertions (:87 `sl.index.ftTransfers({`, :101 `SBTC_CONTRACT_ID`) → validates: `bun test apps/web` + `bunx tsc`, visual
- [x] T6: layer-word purge across `apps/web/src` (not just (www)): homepage "indexing layer" → "hosted indexer", `components/site-footer.tsx:80` "The indexing layer for Stacks" (sitewide footer), `components/home/home-sections.tsx:91` + `streams/page.tsx` "the layer you'd run a node for" → "what you'd run a node for" (phrase duplicated both places), `docs/sdk/page.mdx:25` "`sl.index` — the decoded layer", llms.txt route (:1) "indexing layer" → "the hosted indexer for Stacks". Leave `docs/changelog/page.mdx:108` (historical). SAME COMMIT: update `www.smoke.test.tsx:36` assertion on "indexing layer for Stacks" → validates: `bun test apps/web` green + `grep -rinE "(read|indexing|delivery|decoded) layer|layer you'd|One layer" apps/web/src` returns zero
- [x] T6b: OG share cards — wording is baked into static PNGs (`public/og/*.png`, commit 556f46f7), not greppable: inspect each card for "layer" wording; regenerate any offenders (separate image task), else confirm clean and close → validates: visual inspection of 7 PNGs
- [x] T7: `docs/streams/page.mdx` — promote consume-with-checkpoint + `replay()` seam example from SDK README into the page; qualify "never miss an event" ("with a committed cursor, within tier retention"); add composition proof line ("Index itself is a Streams consumer — our decoder runs on this firehose") → validates: snippets typecheck, page renders
- [x] T7b: composition story on all three product pages + Which API close: index-api "powered by Streams — the same firehose you can consume"; subgraphs "runs on Index — the same rows you can sweep"; streams "what Index is built on"; Which API closing line gains "each product is built on the one below — we sell the primitives we run on" → validates: copy grep, visual
- [x] T8: `pricing/page.tsx` reorder, zero number changes (Free/Pro $99/Ent locked). Actual delta is small: reorder `PRO_INCLUDES` (:27) so private subgraphs → genesis backfill → webhook scale lead and "250 req/s" drops to mid-list ("Priority indexing" is ALREADY the Enterprise summary :35-36 — no move needed); CTA band :77 "you're querying in seconds" → "you're indexing in minutes" → validates: visual, pricing smoke test
- [x] T9: `packages/mcp/README.md` fix false dumps-key claim (:17 — public, needs only `SL_STREAMS_DUMPS_URL`) + "subgraph platform" (:3) → hosted-indexer 3-product frame; `packages/sdk/README.md` rewrite Mental model (:37-42) as jobs not reads, deploy snippet to top, "Second Layer" (:3, :250) → "Secondlayer". Changesets for both packages in this commit → validates: grep, README review

Each task = its own single-line conventional commit; `/check` green is the sprint exit gate.

Guardrail: no copy stronger than "you bring the loop" ships in this sprint.

## Sprint 2 — Make it true: `sl.index` checkpointed consumer (demoable: kill/restart an Index tail, it resumes + survives a reorg)

Dep: none on Sprint 1 (can run parallel); Sprint 3 depends on this.

- [ ] T11: `packages/sdk/src/index-api/consumer.ts` — port `consumeStreamsEvents` contract (`packages/sdk/src/streams/consumer.ts` = spec): `consumeIndexEvents` + `consumeIndexContractCalls` with fetcher abstraction, `onBatch(events, envelope, {cursor})` returning committed cursor, `onReorg(reorg, {cursor})` auto-rewind to fork-point cursor, default sleep/backoff. Respect per-resource cursor keyspaces; support `fromHeight: 0` start. NOT a straight port — `finalizedOnly` diverges: Streams gates on per-event `finalized` flag (consumer.ts:138-143); Index events have no flag, gate by height vs tip `finalized_height` instead. Prereq subtask: extend SDK `IndexTip` (`index-api/client.ts:7-10`, currently `{block_height, lag_seconds}`) with `finalized_height` — API already returns it (`packages/api/src/index/tip.ts:15-24`) → validates: `bunx tsc` clean
- [ ] T12: wire `sl.index.events.consume()` / `sl.index.contractCalls.consume()` onto client via the streams pattern (standalone fn + thin `consume()` wiring, cf. client.ts:277,:299; resources already `Object.assign` callable `.list`/`.walk`); export types → validates: tsc + API-surface review
- [ ] T13: unit tests mirroring streams consumer suite: checkpoint advance, onBatch cursor override, reorg rewind to lowest fork point, finalizedOnly holds back to finalized_height, dedup of handled reorgs → validates: `bun test packages/sdk` green + live check (tail prod ft_transfer N batches, kill, restart from persisted cursor, no gap beyond at-least-once)
- [ ] T15: changeset (sdk minor) + release via bun release workflow → validates: `npm view --prefer-online`

## Sprint 3 — Flagship examples + strong claims (demoable: every service has one runnable artifact carrying its positioning)

Dep: Sprint 2 (consume() collapses the loop), Sprint 1 (pages to slot into).

- [ ] T16: Index flagship `sales-index/` (~50 lines): `sl index codegen --target kysely` schema + `checkpoints` table → `contractCalls.consume({contractId, functionName, fromHeight: 0})` → upsert + cursor commit atomic → reorg DELETE orphaned range + re-sweep → `/canonical` reconcile on startup → live tail. Ships on `docs/index/page.mdx`, index-api hero as third `checkpoint.ts` tab, SDK README → validates: runs against prod; kill/restart resumes; snippets typecheck
- [ ] T17: graduation demo — same sales table as one `defineSubgraph()` file, REAL `sl subgraphs deploy` output printing the public curl URL (rendered nowhere in docs today; CLI prints Read/Share URLs only for `visibility: "public"` — cli/subgraphs.ts:1074-1084, so demo must deploy public/published); webhook attach; every Index loop example ends "this loop is a subgraph — one file, zero ops"; cross-links both directions → validates: deployed to prod, curl works
- [ ] T18: genesis backfill demo — `sl subgraphs backfill` with `blocks_behind` draining output + replay-safe-handler note (marquee $99 feature, currently demonstrated nowhere) → validates: run against prod subgraph, output captured
- [ ] T19: Streams flagship `indexer-from-zero.ts` — `events.replay({from:'genesis'})` signed-dumps backfill → live seam → `consumeStreamsEvents` w/ checkpoint + auto reorg rewind; finalizedOnly variant noted → validates: runs against prod
- [ ] T20: Streams DuckDB sidebar — `sl streams pull` (sha256-verified) → `duckdb 'SELECT event_type, count(*) FROM read_parquet(…) GROUP BY 1'` — first dumps usage example anywhere → validates: run locally, output captured
- [ ] T21: copy-strengthening pass (only now): Index surfaces may claim "build your app index on decoded events"; hand-rolled docs loop collapses to ~12-line consume() snippet; Subgraphs "REST, not GraphQL" sentence near hero + soften "redeploy and it reindexes for you" (BYO breaking deploys → migration plan) → validates: copy grep, smoke

## Standing guardrails

- "Backfill" copy ships with the default-window callout in the same commit.
- Loop nouns (checkpoint, reorg rollback) stay off the homepage golden path.
- Pricing: Index reads stay rate-tier-shaped (per 2026-06-12 pricing audit) — indexing-first is lead order, not metering claims.

## Unresolved questions (founder)

1. STRATEGY.md one-liner — approve proposed wording in T1, or supply your own?
2. Streams prominence: focus-audit 2026-06-10 demoted Streams→"Dumps feature" under the 2-product taxonomy; today's ruling elevates it as the raw-indexer product AND the substrate powering Index. T1 already amends the :49-57 we-do/you-do table (which currently assigns "build your own indexer" exclusively to Streams); still open: does Streams return to nav/homepage as a peer build path?
3. `sl index sync` scaffold — `sl index codegen` already shipped, so this is net-new command only (loop + checkpoint table). Worth building, or does the cli local-dev freeze (cli@8.8.0) keep it out?
4. Sprint 1 copy holds at "Decoded chain data, kept indexed" until consume() ships — OK, or do you want Sprints 1+2 landed together so headlines go straight to "build your app index"?

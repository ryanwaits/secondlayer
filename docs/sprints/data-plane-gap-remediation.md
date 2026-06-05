# the reference model Gap Remediation — Master Roadmap

Ten hardened per-gap plans from the the reference model audit, sequenced into one dependency-aware execution order. P0 = correctness/safety bugs landing now (G1 schema-contract drift, G3 reorg undercount); P1 = decoupling + horizontal-scale + DB-split hardening (G2 pox-4 HTTP, G6 compose dep, G5a Redis limits, G4 source/target DB split); P2 = service extraction + block-source deletion + cold-lane signing + tx reorg reader (G5b, G-blocksrc, G7, G-txreorg). House style preserved: terse, grammar sacrificed for concision. Cross-gap deps resolved inline (e.g. G2 before G-blocksrc S3; G4-S1 reroute before any env split; G7 sign+backfill before verify:on). Each gap = its own changeset(s) + release via bun release workflow; `api`/`indexer` are private (changesets auto-skip indexer; api keeps a changeset per house rule).

---

## CONSOLIDATED OPEN QUESTIONS (founder decisions, deduped)

Decisions blocking or shaping execution. Grouped by gap; resolve the BLOCKER ones before the named sprint.

**Cross-cutting / sequencing**
- [ ] **Batched release vs per-gap release?** MEMORY shows in-flight `agent-native-parity` batched release. Decide which gaps fold into it (esp. G3-S2 shared move, G-blocksrc major bump) vs ship standalone.
- [ ] **Does deploy.yml gate MERGES?** Push-to-main triggers Deploy (1-2min 502). No PR-time check today => contract tests (G1) only run post-merge. Add a `pull_request` typecheck trigger, or accept post-merge red? (G1)
- [ ] **CI test DBs:** Do indexer/shared test jobs provision a migrated Postgres (events/transactions/blocks/chain_reorgs)? If not, DB-gated tests (G3 reorg.test, G-txreorg chain-reorgs.test, G1-S4 introspection) silently SKIP => false-green. Confirm before relying on them. (G3, G4, G1, G-txreorg)

**G1 (schema-contract)**
- [ ] INDEX_EVENT_CONFIG ownership: keep in api + pass cols to a pure indexer reader (default), or move config into indexer (single-source producer-side)? Blocks S2-T1.
- [ ] Reader module placement convention: `src/index/*` vs `src/` root vs `src/readers/*`. Exports map + every import path depends on it. Blocks S2-T1.
- [ ] DbReadRow widening: uniform widen ALL numerics to `string|number` (forces Number() at call sites, already done) vs per-column ColumnType-aware mapping?
- [ ] Ship S4 (live-PG introspection job) this batch or defer? Adds PG service + CI latency + flake; S1-S3 already catch the dominant rename case.
- [ ] topic enum narrowing: keep `string` in read row (api normalize expects string) vs propagate SbtcEventTopic enum? Blocks S3-T1.

**G3 (db-event vocab / reorg undercount)**
- [ ] `new_canonical_tip` value at handleReorg time (reorg.ts:95): keep `{forkPoint,0}`, use highest surviving canonical below forkPoint, or nullable-updated-later (needs schema/migration, out of G3 scope unless folded)?
- [ ] Clean up 4 inline label literals (streams-events.ts:340, stx-transfers:75, streams-payload-schema, node-events) now or separate follow-up? Recommend follow-up (not all const-driven; node-events is upstream node type).
- [ ] db-event-types.ts as new file (recommended, avoids agent-native-parity event-types.ts conflict) vs append to event-types.ts?

**G2 (pox-4 HTTP)**
- [ ] **DEFAULT-ON vs OPT-IN** for pox-4/stacking? Drives S3-T1 branch. Default-on = stacking populates w/o env (+1 HTTP loop); opt-in = current + POX4_DISABLED_NOTE.
- [ ] Fresh-enable seed: start AT tip (current intent, no history) vs BACKFILL from pox-4 genesis (666050+)? Backfill = separate window task.
- [ ] fetchContractCalls home: shared IndexHttpClient only (decoder uses it, avoids SDK cycle) — confirm not also SDK IndexApiClient.

**G5a (Redis rate-limit)**
- [ ] **Fail-OPEN on Redis outage** (recommended; limits stop enforcing, no 503 storm) vs fail-CLOSED (429)? Plan assumes fail-open.
- [ ] Existing Redis/Valkey on prod box to point REDIS_URL at, or stand up new redis service? MEMORY shows only postgres.
- [ ] ZSET sliding-window (chosen, accurate) vs fixed-window INCR/EXPIRE (cheaper)?
- [ ] Scope = all 4 limiters (API-key+IP @60s, streams+index @1s) vs only per-second surfaces?
- [ ] redis `appendonly no` (ephemeral, recommended) vs persist for warm restart?

**G4 (source/target DB split)**
- [ ] **DECODED-SET HOME (blocks plan shape):** decoded_events + l2_decoder_checkpoints + sbtc_*/bns_*/pox4_* currently TARGET-written but chain-READ from source. Move to SOURCE (recommended — chain-derived, api readers already source-read them) or keep TARGET (cross-DB read)? Drives S1-T4 active vs no-op.
- [ ] Confirm intent = isolate CHAIN onto SOURCE (this plan), NOT move billing (billing already on getTargetDb).
- [ ] DDL strategy: full schema to BOTH DBs (empty opposite-set, simplest) vs partition via SPLIT_MODE? Recommend apply-all-to-both + optional 0089 drop.
- [ ] Cutover window: dump/restore downtime acceptable vs need logical-replication zero-downtime?
- [ ] Remove DATABASE_URL entirely in split-mode prod (surfaces misconfig, recommended) vs keep as safety default (masks it)?

**G5b (subscriptions service extraction)**
- [ ] Single replica or N? Combined service @ replica=1 (simple, recommended) vs split evaluator(1)+emitter(N)?
- [ ] Keep a fallback emitter in subgraph-processor for defense-in-depth? Recommend no.
- [ ] SUBSCRIPTIONS_STALE_MS: reuse SUBGRAPH_PROCESSOR_STALE_MS or tighter?
- [ ] S5-T1: does `indexer:new_block` NOTIFY fire under streams-index? If clock is public-API-only => wake is no-op, drop S5.

**G-blocksrc (delete PostgresBlockSource)**
- [ ] Confirm scope = runtime decoupling ONLY (Index API endpoints still read getSourceDb; source DB stays).
- [ ] Stop after Sprint 2 to soak HTTP default in prod (rollback alive), ship Sprint 3 delete later? Recommend two releases.
- [ ] Default-path catch-up latency = SUBGRAPH_POLL_MS (5s) vs near-instant NOTIFY — acceptable? If sub-5s needed, keep source-DB new_block LISTEN as pure wake (no data read).
- [ ] golden-diff parity harness post-delete: snapshot fixtures once in-cluster + convert to conformance (S3-T8), or run one final live diff then retire?

**G7 (sign bulk manifest)**
- [ ] Embedded `signature` field (recommended, matches R2-direct SDK path) vs sidecar .sig vs S3 metadata header?
- [ ] Same signing key cold+live (one /public/streams/signing-key, recommended) vs distinct cold-lane key_id?
- [ ] SDK verify default OFF (current, recommended) vs flip ON after backfill?
- [ ] Backfill scope: re-sign ALL history/*.json (S7) or latest+recent N? Old unsigned history fails-closed once verify on.
- [ ] Any external consumers already pinning verify:true? Enabling fail-closed manifest verify is breaking for them pre-backfill.

**G-txreorg (tx reorg reader)**
- [ ] **INTENT (blocker):** emit reorgs[] on /transactions, or keep doc-only "poll Streams /reorgs"? Route discovery ALREADY advertises reorgs[] (live API lying). Recommend FIX.
- [ ] SCOPE: fix /contract-calls too (S3)? Recommend YES (byte-identical stub, type already StreamsReorg[]).
- [ ] SEMANTICS: height-only overlap is coarser than events' 2D keyset — over-inclusive (never under-reports). Acceptable?

---

## CONSOLIDATED RISKS

**G1**
- PRIMARY: Selectable<...Table> != runtime (postgres.js returns int8/numeric as strings). DbReadRow widening helper (S1-T1) is load-bearing; under-widen => derived rows stricter than reality, Number()/num() call sites break. Spot-test before S2.
- Computed/aliased cols not on table interface (decoded_events.block_time subquery, stream_event_index window, stx-transfers CTE). Must intersect explicit computed-col types.
- Bulk delete ~13 hand-declared *DbRow across 10 files — field-by-field diff steps mandatory or subtle response-shape regressions.
- Cross-package coupling: api row shapes track indexer write-schema; deliberate rename forces api change + changeset churn (desired but coordination cost).
- CI: deploy.yml has NO bun test + NO PG today. S1-T4 adds focused test (cheap); S4 PG job = latency + container flake (gate w/ healthcheck, optional).
- Import-cycle: must stay api->indexer->shared only.
- Published-version skew: api deps indexer ^1.12.2 as npm range (symlinked locally/CI). At release, published api must resolve published indexer w/ new exports — S2-T4 bumps range.

**G3**
- BIGGEST: handleReorg COUNT (reorg.ts:62-67) does NOT filter canonical; firehose joins canonical=true. Multi-fork reorg => over-count. SEPARATE latent bug; test seeds one block at H so moot. Do NOT claim G3 fully reconciles COUNT w/ firehose.
- stream_event_index is per-block dense rank, not bare COUNT. Test MUST derive expected from same vocab, never raw events COUNT.
- TIMING: handleReorg sets canonical=false before returning; post-call firehose read = 0. Capture expected pre-call.
- S2-T3 changes streams-events.ts export identity; streams-bulk/query.ts + api import from it — re-export must hold.

**G2**
- DRAFT'S BIGGEST BUG: IndexHttpClient.walk() DRAINS all pages => reusing for pox-4 = O(all-history)/tick. Fixed by single-page fetchContractCalls (S1-T2).
- function_args: map function_args_hex (raw) via JSON.stringify, NOT function_args (decoded). Wrong field corrupts every row.
- result: map result_hex to raw_result, NOT result. Wrong field corrupts result_ok + aggregation.
- block_time + burn_block_height NOT on IndexTransactionRow — join via walkBlocks Map; verify pox4_calls.burn_block_height nullability before skip-on-missing.
- block_time format: API serves ISO string; old SQL used bigint epoch. coerceBlockTime handles ISO.
- indexTip bound: fetchContractCalls toHeight = getIndexTip(), not Streams clock, else stall.
- Reorg: handlePox4Reorg is DEAD; cutover reorg-neutral. Reorg un-canonicalizing written pox4_calls = pre-existing gap, out of scope.
- Internal Index reads must stay unmetered (INDEX_INTERNAL_TENANT_ID no account_id); confirm tenant seeded or 401/metering bites.
- 3 duplicated POX4_DECODER_ENABLED checks (service.ts:31, storage.ts:77, stacking.ts:122) — edit in lockstep until S3-T2 single-sources.

**G6**
- Hardening not outage-fix: restart:unless-stopped self-heals today; this removes crash-loop window on full restart only.
- depends_on gates FIRST start only; api unhealthy post-boot does NOT stop processor (runtime relies on HTTP retries).
- Marginal startup delay (api healthcheck waits on migrate) — within existing Deploy 502 cost.
- depends_on merges additively — do NOT restate migrate/postgres in override.

**G5a**
- Per-request Redis round-trip = latency + hard new dep. Fail-open caps blast radius but limits stop enforcing silently — needs a metric/alert (not in plan).
- Bun.redis has NO typed eval/multi — use redis.send('EVAL',[...]) all-string args; reply untyped (parse defensively).
- Lua return types (ZRANGE WITHSCORES, ZCARD) come back strings via RESP — explicit number coercion or retryAfter/resetAt drift.
- Member uniqueness under same-ms burst: use now-UUID member (pure timestamp overwrites in ZADD => undercount).
- resetAt/retryAfter math must byte-match current SlidingWindow header contract or clients drift across switch.
- CI has no redis: keep REDIS_URL UNSET so in-proc path runs; Redis describe block skipIf(!REDIS_URL).
- Deploy: new redis container must come up healthy before api (depends_on health gate on first deploy).
- Memoized singleton reads REDIS_URL at first call; tests toggling REDIS_URL must reset singleton.

**G4**
- BIGGEST: chain WRITE path uses getDb()==getTargetDb. If env splits chain->SOURCE BEFORE S1 reroutes writes, indexer writes chain to TARGET while readers read SOURCE => empty datasets/subgraphs, silent in single-DB. S1 MUST land+deploy before any env split.
- Silent fallback: unset/typo'd SOURCE_/TARGET_DATABASE_URL both resolve to DATABASE_URL => split no-ops. Mitigated by assertDbSplit (S2-T2) + current_database() smoke.
- LISTEN/NOTIFY split: indexer NOTIFY moves to SOURCE after reroute; processor sourceListenerUrl binds SOURCE — verify NOTIFY actually fires on SOURCE post-reroute.
- 3 compose files (yml, dev.yml, hetzner.yml) set only DATABASE_URL — rewire ALL THREE.
- Data migration destructive: chain volume 100s GB. Snapshot before cutover; NEVER `docker compose run migrate` against chain instance.
- Dump/restore FK order: accounts before 9 cascade children — use --section split, not naive --table.
- 0089 drop irreversible w/o snapshot; gate behind stability window (S3-T4).

**G5b**
- DOMINANT: cutover ordering. Sprint 3 (add) + Sprint 4 (remove) in ONE deploy => window w/ NEITHER emitting => delivery gap. MUST be two deploys (SKIP-LOCKED-safe overlap, canary-verify, then remove).
- Post-cutover ALL subscription delivery (chain AND subgraph) depends on subscriptions service up. New single op dep. Mitigate: restart:unless-stopped + heartbeat alert.
- Dual-DB caveat (pre-existing): emitter LISTENs on default DATABASE_URL; outbox+NOTIFY on TARGET. Single-DB prod fine; confirm TARGET_DATABASE_URL/DATABASE_URL identical to today's processor.
- S4-T1 must NOT regress subgraph reorgs: only chain callback (3rd arg) removed; handleSubgraphReorg + loadDef stay.
- chain-reorg-poll = 2nd independent /v1/streams/reorgs poll => 2x load; both start since=now-1h => restart re-scans 1h (idempotent via dedup_key).
- API-shape drift: startTriggerEvaluator/startStreamsReorgPoll SYNC ()=>void; startEmitter async. Composed stop mixes sync+async.

**G-blocksrc**
- PublicApiBlockSource fetches only referencedIndexEventTypes; deleted DB loadBlockRange fetched ALL. Safe: contract_call/deploy expand to ALL_INDEX_EVENT_TYPES + filterless _eventId fallback removed (S3-T1). Verify no active subgraph uses '*' handler WITHOUT a named source covering needed types.
- _eventId in fallback = real DB events.id; PublicApiBlockSource synthesizes ${tx_id}#${event_index}. Confirm no historical subgraph persisted _eventId as stable key.
- Post-S2/S3 reorg detection solely via streams-reorg-poll; no Postgres fallback. Streams reorg-feed outage = SPOF. Confirm SLA.
- getTip = Index tip; if Index lags Streams clock, subgraphs stall by design w/ no DB-tap escape after S3. Monitor lag.
- Major bump @secondlayer/subgraphs — coordinate batched release; all deleted-export importers are in-package.
- SOURCE_DATABASE_URL already inert for processor (single-DB). Deleting sourceListenerUrl safe; do NOT touch getSourceDb (40+ callers).

**G7**
- Canonicalization drift: sig over stableJsonStringify(manifest minus signature), NOT raw R2 bytes (pretty-printed+newline) NOR res.json output. Indexer MUST reuse shared serializer (S2-T1 deletes private copy); round-trip test guards.
- Fail-closed rollout order: enabling SDK verify before indexer ships signed + before backfill breaks every dumps.list()/replay(). Strict: S1-S4 sign+wire -> deploy -> S7 backfill -> then advise verify:on. SDK verify ships OFF.
- Missing infra: STREAMS_SIGNING_PRIVATE_KEY on api service but NOT indexer (where bulk scheduler runs) — w/o S4-T1 signing silently no-ops.
- Key exposure widens to indexer job env (same key already on api host — no new store, confirm injection scope).
- Rotation: manifest signed w/ old key fails-closed until re-signed; coordinate rotation w/ exporter (latest) + S7 (history) re-sign.
- schema_version 0(indexer)-vs-1(SDK fixture) pre-existing/orthogonal; serializer value-agnostic (test both).

**G-txreorg**
- Over-inclusive signal: page whose txs sit in canonical part of partially-orphaned height could still surface reorg. Low (whole-height orphaning). Never under-reports.
- Cache: applyIndexCache embeds response.reorgs in ETag stable slice (L340,L429); ETag only set when fullyFinalized; reorgs touch non-finalized only => no stale-empty serving. Verify fullyFinalized def.
- S1-T2 DB test needs migration 0068 applied locally; errors (not skips) without it. Add precondition note.
- ChainReorgRecord exposes event_index-keyed cursors tx consumers can't use; document height-granular reconciliation (fork_point_height).
- Editing infrastructure-audit.html risks documenting redesign-WIP as canon — restrict S3-T4 to factual reorg-cell text only.

---

## SEQUENCED EXECUTION ORDER (P0 → P1 → P2)

Dependency-aware checklist. `[unblocks: X]` = completing this unblocks gap X. Within a tier, top-to-bottom is the recommended order; items at the same indent w/o deps are parallelizable.

### P0 — correctness/safety, land first
- [ ] **G1** Owned read-contract modules + compile-time + CI drift test. STANDALONE. Reconcile w/ any future DB-VIEW gap before S3. (S1 belt → S2 first producer → S3 rest → S4 optional PG introspection)
- [ ] **G3-S1** reorg.ts COUNT undercount fix (import existing streams-events.ts canonical list). STANDALONE, ships before agent-native-parity merges. [unblocks: nothing hard; G-txreorg is insensitive to G3 by design]
- [ ] **G3-S2** Hygiene: move db-event vocab to @secondlayer/shared. COORDINATE shared/src/index.ts barrel edit w/ agent-native-parity Sprint 0.

### P1 — decoupling, scale-correctness, DB-split (after P0)
- [ ] **G6** hetzner subgraph-processor depends_on api:service_healthy. SINGLE atomic change, no deps. Ship anytime.
- [ ] **G2** Re-source pox-4 over HTTP; drop its getSourceDb data-read. [unblocks: G-blocksrc S3 — operational confirm G2 adds no getSourceDb the processor relies on]
- [ ] **G5a** Redis-backed rate-limit (correctness under scale). [unblocks: future G5b-replica scale-enablement gap]
- [ ] **G4** Split chain onto SOURCE_DATABASE_URL. ORDER-CRITICAL internally: S1 reroute chain WRITES to getSourceDb → deploy → S2 dual-migrate + 2nd postgres → S3 staging cutover. DECODED-SET HOME open Q blocks S1-T4 shape. S2-T1 dual-migrate.ts = prereq for any per-DB DDL gap.

### P2 — extraction, deletion, signing, reorg reader (after P1)
- [ ] **G-txreorg-S1** shared readChainReorgsForHeightRange. [unblocks: G-txreorg API wiring]
- [ ] **G-txreorg-S2/S3** wire /transactions (+/contract-calls) reorgs[]. INTENT open Q is blocker.
- [ ] **G5b** Extract subscriptions service. TWO-DEPLOY cutover mandatory (S3 add alongside processor → canary → S4 remove from processor). S5 optional, gated on new_block NOTIFY existing.
- [ ] **G-blocksrc** Make streams-index default → delete PostgresBlockSource. S1 default-flip (reversible) → S2 source-independent clock → S3 DELETE. **S3 AFTER G2 ships + confirms no new getSourceDb dep the processor relies on.** Recommend two releases (soak S1-S2, delete in S3 later). POINT OF NO RETURN at S3-T2.
- [ ] **G7** Sign bulk parquet manifest. STRICT ORDER: S1-S4 (sign+key wiring) → deploy indexer → S7 backfill historical manifests → THEN flip SDK verify on. S5 SDK verify ships default OFF.

---

## TASK / SPRINT SUMMARY PER TIER

| Tier | Gaps | Sprints | Atomic tasks |
|---|---|---|---|
| **P0** | G1, G3 | 6 (G1:4, G3:2) | 25 (G1:15, G3:10) |
| **P1** | G2, G6, G5a, G4 | 11 (G2:3, G6:1, G5a:3, G4:3) | 32 (G2:14, G6:1, G5a:11, G4:6 listed by id — chain spans ~15 reroute call-sites) |
| **P2** | G5b, G-blocksrc, G7, G-txreorg | 19 (G5b:5, G-blocksrc:3, G7:7, G-txreorg:3) | 51 (G5b:11, G-blocksrc:18, G7:18, G-txreorg:13 minus shared) |

Rough totals: **~36 sprints, ~108 atomic tasks** across 10 gaps. P0 is small/high-value; G4 + G7 + G-blocksrc carry the heaviest task load and the most irreversible steps.

---

# GAP SECTIONS

---

## G1 [P0] Owned read-contract module per producer + compile-time + CI schema-contract drift test

Every public read in api runs raw SQL into the indexer write schema via getSourceDb() w/ hand-declared *DbRow types. Producer column rename = silent runtime break, zero compile signal. Fix Option (a): one producer-owned typed reader module per producer in packages/indexer; api imports them. Compile-time contract enforced by existing `bun run typecheck` = `--filter '*'` (covers api+indexer; NOT by `build` which skips api/indexer). Two draft flaws fixed: (1) deriving from Selectable<...Table> is WRONG at runtime (postgres.js numerics->strings; Table says number, DbRow says string|number) => DbReadRow<T,K> widening helper; (2) snapshot must key off SELECTED read columns, not keyof Table.

**Cross-gap:** Standalone. If a separate gap introduces DB VIEWs for read isolation it supersedes the owned-module approach — reconcile before S3. No migrations (read-only refactor); S4 depends on EXISTING migration harness staying runnable.

### Sprint 1 — Drift compile-time detectable + CI bun-test belt
- [ ] **G1-S1-T1** Add `packages/shared/src/db/read-row.ts`: `DbReadRow<T,K>` = mapped Pick<Selectable<Database[T]>,K> widening number->`string|number`, Date->`Date|string`, preserve null; export NumericAsText. Re-export from db/index.ts. — files: read-row.ts, db/index.ts — validate: `cd packages/shared && bunx tsc --noEmit`; spot type-test `DbReadRow<'sbtc_events','block_height'>['block_height']` = string|number NOT number. — deps: — — commit: `feat(shared): add DbReadRow driver-accurate read-row helper`
- [ ] **G1-S1-T2** Add `packages/shared/src/db/source-read-columns.ts`: SOURCE_READ_COLUMNS const map for all 16 source reads, `satisfies {[T]: readonly (keyof Database[T])[]}`. — files: source-read-columns.ts — validate: tsc passes; bogus col fails tsc; non-Database key fails tsc. — deps: G1-S1-T1 — commit: `feat(shared): declare SOURCE_READ_COLUMNS read-contract map`
- [ ] **G1-S1-T3** Commit `test/__snapshots__/source-read-columns.json` (generated once via inline bun, no ts-morph) + `test/source-read-columns.test.ts` (bun, NO PG) deep-equal per table. — files: source-read-columns.test.ts, snapshot json — validate: `bun test source-read-columns` passes; remove a col => fails. — deps: G1-S1-T2 — commit: `test(shared): snapshot SOURCE_READ_COLUMNS drift guard`
- [ ] **G1-S1-T4** Add deploy.yml typecheck-job step AFTER typecheck: `bun test packages/shared/test/source-read-columns.test.ts` (focused, no PG). Changeset g1-schema-contract (@secondlayer/shared patch). — files: deploy.yml, .changeset/g1-schema-contract.md — validate: CI shows step green. — deps: G1-S1-T3 — commit: `ci: run shared schema-contract test in typecheck job`

### Sprint 2 — First producer migrated (decoded_events) end-to-end
- [ ] **G1-S2-T1** RESOLVE INDEX_EVENT_CONFIG ownership OQ (default: keep in api, pass cols to pure reader). Create `packages/indexer/src/index/decoded-events-read.ts`: readDecodedEventRows + IndexEventRow = `DbReadRow<'decoded_events',...> & { cursor: string; block_time: Date|string|null }` (block_time COMPUTED subquery on blocks). Move SQL (events.ts:321-342) here. — files: decoded-events-read.ts — validate: indexer tsc; IndexEventRow errors if DecodedEventsTable drops a selected col. — deps: G1-S1-T1, G1-S1-T2 — commit: `feat(indexer): add owned decoded-events reader`
- [ ] **G1-S2-T2** Add `./index/decoded-events-read` to indexer package.json exports (mirror ./streams-events). Verify no import cycle (reader imports only shared). — files: indexer/package.json — validate: api tsc resolves the import; indexer has no @secondlayer/api dep. — deps: G1-S2-T1 — commit: `chore(indexer): export decoded-events reader`
- [ ] **G1-S2-T3** Field-diff IndexEventRow (events.ts:181-197) vs derived BEFORE swap. Refactor events.ts: delete local IndexEventRow, import + call readDecodedEventRows. Keep normalizeIndexRow + cursor + keyset comment in api. — files: api/src/index/events.ts — validate: api tsc; events.test.ts; sample /v1/index shape unchanged. — deps: G1-S2-T2 — commit: `refactor(api): consume indexer decoded-events reader`
- [ ] **G1-S2-T4** Changeset g1-decoded-events (@secondlayer/indexer minor + @secondlayer/api patch). Bump api->indexer dep range to released minor. — files: .changeset/g1-decoded-events.md, api/package.json — validate: rename DecodedEventsTable.amount => root typecheck FAILS in api; revert green. — deps: G1-S2-T3 — commit: `chore: changeset g1 decoded-events owned reader`

### Sprint 3 — Remaining producer reads migrated (each group its own commit)
- [ ] **G1-S3-T1** sbtc readers (sbtc-read.ts; do NOT reuse parquet readCanonicalSbtcEventRows). 2 exports. — validate: indexer tsc; row types match deleted DbRow. — deps: G1-S2-T4 — commit: `feat(indexer): add owned sbtc readers`
- [ ] **G1-S3-T2** Refactor api sbtc/query.ts: delete SbtcEventDbRow/SbtcTokenEventDbRow, import readers. — validate: api tsc; datasets/sbtc tests; rename SbtcEventsTable.amount => typecheck fails. — deps: G1-S3-T1 — commit: `refactor(api): consume indexer sbtc readers`
- [ ] **G1-S3-T3** bns readers (bns-read.ts; 5 readers). — validate: indexer tsc; 5 row types match. — deps: G1-S2-T4 — commit: `feat(indexer): add owned bns readers`
- [ ] **G1-S3-T4** Refactor api bns/query.ts: delete 5 DbRow, import readers. — validate: api tsc; datasets/bns tests. — deps: G1-S3-T3 — commit: `refactor(api): consume indexer bns readers`
- [ ] **G1-S3-T5** burnchain-read.ts + pox4-read.ts. — validate: indexer tsc. — deps: G1-S2-T4 — commit: `feat(indexer): add owned burnchain+pox4 readers`
- [ ] **G1-S3-T6** Refactor api burnchain/query.ts + pox-4/query.ts. — validate: api tsc; datasets tests. — deps: G1-S3-T5 — commit: `refactor(api): consume indexer burnchain+pox4 readers`
- [ ] **G1-S3-T7** core-chain-read.ts (blocks/transactions/events/chain_reorgs; JOIN/CTE reads = DbReadRow base + explicit computed-col intersect). — validate: indexer tsc; computed cols present. — deps: G1-S2-T4 — commit: `feat(indexer): add owned core-chain readers`
- [ ] **G1-S3-T8** Refactor 5 core-chain api files (transactions/contract-calls/stacking/stx-transfers/network-health). Field-diff each (highest computed-col risk). — validate: api tsc; tests; /v1 shape unchanged. — deps: G1-S3-T7 — commit: `refactor(api): consume indexer core-chain readers`
- [ ] **G1-S3-T9** Grep lint guard `scripts/ci/no-raw-source-reads.sh` (must pass `bash -nu`); wire into deploy.yml. Changeset g1-owned-readers (@secondlayer/indexer minor + @secondlayer/api patch). — validate: script exits 0 on refactored tree, nonzero on reintroduction. — deps: G1-S3-T2,T4,T6,T8 — commit: `ci: guard against raw source-table DbRow reads`

### Sprint 4 — Optional live-PG introspection (needs new CI PG job)
- [ ] **G1-S4-T1** `test/source-schema-introspection.test.ts` skipIf(!DATABASE_URL): reuse migration-test harness, assert live information_schema.columns is SUPERSET of read list. — validate: w/ DATABASE_URL+migrated passes; rename a read col via migration w/o updating SOURCE_READ_COLUMNS => fails. — deps: G1-S1-T3 — commit: `test(shared): live-PG schema introspection superset check`
- [ ] **G1-S4-T2** deploy.yml `schema-contract` job (postgres service, migrate, run introspection). `build-images needs: [typecheck, schema-contract]`. — validate: job green; drift => red, build blocked. — deps: G1-S4-T1 — commit: `ci: add schema-contract PG job gating deploy`

**Open Qs:** see consolidated (INDEX_EVENT_CONFIG ownership; reader placement; widening policy; ship S4?; topic enum; deploy.yml merge-gate).
**Risks:** see consolidated G1.

---

## G3 [P0] Single-source DB-event-type vocab; fix reorg.ts forked list omitting contract_event

streams-events.ts:15-33 ALREADY holds the complete 12-entry STREAMS_DB_EVENT_TYPES incl contract_event + both direction maps — draft premise that it's missing was FALSE. The ONLY stale fork is reorg.ts:9-21 (11 entries, omits contract_event). handleReorg COUNT undercounts prints on post-rename blocks => wrong orphaned_to.event_index in immutable chain_reorgs ledger. Fix bug first (import existing canonical list), move vocab to shared second (hygiene).

**Cross-gap:** agent-native-parity Sprint 0 owns shared/src/event-types.ts. G3-S2 adds a NEW sibling shared/src/db-event-types.ts to avoid editing event-types.ts — but both edit shared/src/index.ts barrel; coordinate that edit. S1 (bug fix) has NO cross-gap dep, ships before that branch merges.

### Sprint 1 — The P0 bug fixed in isolation
- [ ] **G3-S1-T1** reorg.ts: delete local STREAMS_DB_EVENT_TYPES (9-21); import from `./streams-events.ts` (NOT shared yet). — validate: indexer tsc; grep 'smart_contract_event' in reorg.ts empty; import present. — commit: `fix(indexer): reorg COUNT includes contract_event prints`
- [ ] **G3-S1-T2** reorg.test.ts skipIf(!DATABASE_URL): seed canonical block H, txs, events mixing contract_event print + stx_transfer_event. No assertions yet. — validate: skips w/o DATABASE_URL; seeds w/o NOT-NULL/FK errors w/ it. — deps: G3-S1-T1 — commit: `test(indexer): scaffold reorg DB test seed`
- [ ] **G3-S1-T3** Test body: capture firehoseCount BEFORE handleReorg (canonical flips to false after), assert orphaned_to_event_index === firehoseCount-1 incl the contract_event print. — validate: passes on fixed code; restoring 11-entry list => FAILS. — deps: G3-S1-T2 — commit: `test(indexer): assert reorg counts contract_event`
- [ ] **G3-S1-T4** Changeset g3-indexer-reorg-undercount (patch @secondlayer/indexer). — validate: changeset status shows indexer patch. — deps: G3-S1-T1,T3 — commit: `chore: changeset g3 reorg undercount fix`

### Sprint 2 — Hygiene: DB-label vocab single-sourced in @secondlayer/shared
- [ ] **G3-S2-T1** Create shared/src/db-event-types.ts: CUT (not copy) STREAMS_DB_EVENT_TYPES + both maps + rename comment from streams-events.ts:26-70. Import StreamsEventType from ./event-types.ts. Explicit type annotations (isolatedDeclarations on). — validate: shared build green; arity 12/12/11. — commit: `feat(shared): add db-event-types vocab`
- [ ] **G3-S2-T2** `export * from "./db-event-types.ts"` in shared/src/index.ts after line 2. Confirm no collision (STREAMS_EVENT_TYPES vs STREAMS_DB_EVENT_TYPES). — validate: shared build; import resolves from dist. — deps: G3-S2-T1 — commit: `feat(shared): export db-event-types from barrel`
- [ ] **G3-S2-T3** streams-events.ts: remove moved consts; import from shared + re-export (so streams-bulk/query.ts + api unchanged). — validate: indexer tsc; streams-events.test + exporter.test green. — deps: G3-S2-T2 — commit: `refactor(indexer): single-source db vocab from shared`
- [ ] **G3-S2-T4** reorg.ts: change S1 import from ./streams-events.ts to @secondlayer/shared. — validate: indexer tsc; reorg.test green. — deps: G3-S2-T2, G3-S1-T3 — commit: `refactor(indexer): reorg consumes shared db vocab`
- [ ] **G3-S2-T5** Typecheck api (transitive consumer). Guard task, no code change expected. — validate: api tsc green. — deps: G3-S2-T3 — commit: (none if no change)
- [ ] **G3-S2-T6** Changeset g3-shared-db-vocab (@secondlayer/shared patch + @secondlayer/indexer patch). — validate: changeset status. — deps: G3-S2-T3,T4 — commit: `chore: changeset g3 shared db vocab`

**Open Qs:** new_canonical_tip value; inline-literal cleanup follow-up; new file vs append. (see consolidated)
**Risks:** handleReorg canonical-filter gap (separate latent bug); stream_event_index vs bare COUNT; timing (capture pre-call); re-export identity. (see consolidated)

---

## G2 [P1] Re-source pox-4 decoder over HTTP (/v1/index); drop its getSourceDb data-read

pox-4 is the only L2 decoder reading DATA from indexer DB. Streams serves only token/print, NOT contract_call => must use IndexHttpClient against /v1/index/transactions. Add a PAGED single-cursor fetchContractCalls (NOT draining walk()), rewrite pox-4 fetch/seed/tip to HTTP, keep pure decodePox4Tx + tests untouched, drop getSourceDb from pox-4 only.

**Cross-gap:** Full getSourceDb deletion from decoders blocked by bns.ts:6,221 (separate gap). readStacking getSourceDb is API data plane — out of scope. [unblocks G-blocksrc S3 operationally]

### Sprint 1 — IndexHttpClient PAGED contract-call fetch
- [ ] **G2-S1-T1** Add `block_time?: string|null` to IndexTransactionRow (type-only honesty). — validate: shared tsc. — commit: `feat(shared): add block_time to IndexTransactionRow type`
- [ ] **G2-S1-T2** Add `fetchContractCalls(contractId, opts)` returning {transactions, next_cursor} — single GET, cursor XOR from_height. Extract private getPage from walk() body (walk keeps draining for subgraph). — validate: shared tsc; stubbed-fetch test asserts URL params, single page, next_cursor passthrough. — deps: G2-S1-T1 — commit: `feat(shared): IndexHttpClient.fetchContractCalls paged fetch`
- [ ] **G2-S1-T3** Verify walkBlocks returns burn_block_height+block_time (already true). No code change (folded into S1-T2 commit). — validate: grep present. — commit: (none)
- [ ] **G2-S1-T4** Changeset pox4-http-fetchcontractcalls (@secondlayer/shared minor). — validate: changeset status. — deps: G2-S1-T2 — commit: `chore: changeset shared fetchContractCalls`

### Sprint 2 — pox-4 sources over HTTP; getSourceDb removed from pox-4.ts
- [ ] **G2-S2-T1** `createInternalIndexClient()` (new index-client.ts): import defaultInternalIndexApiKey from @secondlayer/shared/index-internal-auth; baseUrl = SUBGRAPH_INDEX_API_URL ?? STREAMS_API_URL ?? http://api:3800. — validate: tsc; env names match block-source.ts. — deps: G2-S1-T2 — commit: `feat(indexer): internal Index HTTP client factory`
- [ ] **G2-S2-T2** Add indexClient + emptyBackoffMs/maxEmptyPolls to ConsumePox4Options (seam-only, both paths coexist). — validate: tsc; pox-4.test green. — deps: G2-S2-T1 — commit: `feat(indexer): pox-4 index-client injection seam`
- [ ] **G2-S2-T3** Rewrite fetchTxBatch to HTTP: fetchContractCalls + walkBlocks Map for burn_block_height/block_time. Map function_args_hex via JSON.stringify, result_hex->raw_result. — validate: stubbed-client test asserts correct burn/block_time + cursor advance; pure tests green. — deps: G2-S2-T2 — commit: `feat(indexer): pox-4 fetchTxBatch over HTTP`
- [ ] **G2-S2-T4** Rewrite seedCheckpointToTip + loop to HTTP (getIndexTip per consume; seed AT tip via encodePox4Cursor(tip, MAX_SAFE)). — validate: empty-range advances to HTTP tip + writeDecoderCheckpoint; fresh-enable seeds to tip. — deps: G2-S2-T3 — commit: `feat(indexer): pox-4 seed+tip over HTTP`
- [ ] **G2-S2-T5** Remove getSourceDb import + sourceDb option from pox-4.ts; keep getTargetDb. — validate: grep getSourceDb empty; tsc; tests green; service.ts compiles. — deps: G2-S2-T4 — commit: `refactor(indexer): drop pox-4 getSourceDb coupling`

### Sprint 3 — default decision single-sourced + docs
- [ ] **G2-S3-T1** DECISION GATE default-ON vs OPT-IN — implement one branch across the 3 gating checks (service.ts:31, storage.ts:77, stacking.ts:122). — validate: identical env semantics; unit test isPox4DecoderEnabled; tsc both. — deps: G2-S2-T5 — commit: `feat: set pox-4 decoder default (<on|opt-in>)`
- [ ] **G2-S3-T2** Single-source isPox4DecoderEnabled() in shared/src/env.ts; consume from all 3. Changeset @secondlayer/shared minor. — validate: exactly one definition; tsc all. — deps: G2-S3-T1 — commit: `refactor: single-source pox-4 enabled predicate`
- [ ] **G2-S3-T3** Update secondlayer-api skill + web docs for /v1/index/stacking. — validate: docs reflect chosen default, no contradictory copy. — deps: G2-S3-T1 — commit: `docs: pox-4/stacking default + notes envelope`
- [ ] **G2-S3-T4** Manual cutover validation (indexer w/ POX4 enabled + SUBGRAPH_INDEX_API_URL, no source DB for decoder). — validate: pox4_calls grows; stacking non-empty; health green; no source-DB read. — deps: G2-S3-T2

**Open Qs:** default-ON vs opt-in; fresh-enable seed-at-tip vs backfill; fetchContractCalls home. (consolidated)
**Risks:** walk() drain; function_args/result mapping; block join nullability; ISO block_time; indexTip bound; reorg-neutral; unmetered tenant; 3 env checks. (consolidated)

---

## G6 [P1] Add depends_on api:service_healthy to hetzner subgraph-processor

Prod runs base + hetzner only. hetzner subgraph-processor sets SUBGRAPH_SOURCE=streams-index; all three streams-index paths (block source, reorg poll, trigger evaluator) route HTTP to api but the override sets no api dep. On full restart the processor can start before api healthy. Compose merges depends_on additively => add api:service_healthy to the HETZNER override only; base/local (flag unset, Postgres tap, no api calls) untouched.

### Sprint 1
- [ ] **G6-S1-T1** Add `depends_on: { api: { condition: service_healthy } }` to hetzner subgraph-processor (env-only block). Do NOT restate migrate/postgres. — files: docker/docker-compose.hetzner.yml — validate: `docker compose -f ...yml -f ...hetzner.yml config` exit 0, processor.depends_on has 3 keys (api+migrate+postgres); base-only render has NO api key. — commit: `fix(docker): make hetzner subgraph-processor wait for api service_healthy`

**Open Qs:** hetzner-only (recommended) vs base. (consolidated)
**Risks:** hardening not outage-fix; gates first start only; marginal startup delay; additive merge. (consolidated)

---

## G5a [P1] Move api rate-limit state to Redis (Bun.redis) for horizontal scale

4 process-local SlidingWindow call sites (API-key+IP @60s, streams+index @1s). Horizontal scale => effective limit N×configured. Redis-backed ZSET sliding-window via Bun.redis (no ioredis, no redis dep — Bun 1.3.10 RedisClient; use redis.send('EVAL',...) — no typed eval). windowMs is per-CALL (constructor-fixed in SlidingWindow => InProc keeps one window per windowMs). Select store by REDIS_URL presence. Fail-OPEN. Delete dead opts.window param.

**Cross-gap:** actual replica scale-out (deploy.replicas>1 + LB + drop host port) is a SEPARATE gap depending on G5a.

### Sprint 1 — stores behind one async interface (no call sites changed)
- [ ] **G5a-S1-T1** `rate-limit-store.ts`: interface RateLimitStore.check(key,limit,windowMs):Promise + clear():Promise (required). — validate: api typecheck. — commit: `feat(api): rate-limit store interface`
- [ ] **G5a-S1-T2** InProcRateLimitStore (Map<windowMs,SlidingWindow>). — validate: store test (limit boundary, windowMs isolation, clear). — deps: G5a-S1-T1 — commit: `feat(api): in-proc rate-limit store`
- [ ] **G5a-S1-T3** RedisRateLimitStore: ONE Lua via send('EVAL',...) (ZREMRANGEBYSCORE+ZCARD+ZADD+PEXPIRE+ZRANGE), member=now-UUID, fail-open. — validate: typecheck; REDIS_URL-gated test (cross-instance share, TTL, boundary, fail-open on dead url). — deps: G5a-S1-T2 — commit: `feat(api): Redis ZSET rate-limit store`
- [ ] **G5a-S1-T4** getRateLimitStore() memoized + _resetRateLimitStoreForTests (SCAN+DEL + reset singleton). — validate: unset REDIS_URL => InProc + memoized. — deps: G5a-S1-T3 — commit: `feat(api): rate-limit store selector`

### Sprint 2 — all 4 middlewares use shared store; opts.window deleted
- [ ] **G5a-S2-T1** auth/rate-limit.ts: await store.check(keyHash,limit,60_000); _resetRateLimits async. Preserve all headers. — validate: rate-limit.test 120 pass+121st 429. — deps: G5a-S1-T4 — commit: `refactor(api): api-key limiter via shared store`
- [ ] **G5a-S2-T2** auth/ip-rate-limit.ts. — validate: ip routes 200/429. — deps: G5a-S1-T4 — commit: `refactor(api): ip limiter via shared store`
- [ ] **G5a-S2-T3** streams/rate-limit.ts: DELETE opts.window param + import; await check(tenant,limit,1_000). — validate: streams routes.test. — deps: G5a-S1-T4 — commit: `refactor(api): streams limiter via shared store`
- [ ] **G5a-S2-T4** index/rate-limit.ts: DELETE opts.window; anon+tenant check @1_000; preserve free-tier upgrade JSON. — validate: index routes.test. — deps: G5a-S1-T4 — commit: `refactor(api): index limiter via shared store`
- [ ] **G5a-S2-T5** Sweep: no SlidingWindow import outside sliding-window.ts + rate-limit-store.ts. — validate: grep empty; full api test + typecheck green. — deps: G5a-S2-T1..T4 — commit: `chore(api): finish rate-limit store migration`

### Sprint 3 — Redis in base compose + changeset
- [ ] **G5a-S3-T1** BASE docker-compose.yml: redis service (redis:7-alpine, appendonly no, healthcheck, no host port); REDIS_URL on api env; api depends_on redis healthy. Do NOT touch oss. — validate: compose config valid; oss untouched. — deps: G5a-S2-T5 — commit: `feat(docker): add redis service for shared rate limits`
- [ ] **G5a-S3-T2** docker/.env.example (verify first): commented REDIS_URL + fail-open note; JSDoc atop rate-limit-store.ts. — validate: grep REDIS_URL; doc present. — deps: G5a-S3-T1 — commit: `docs(docker): document REDIS_URL rate-limit behavior`
- [ ] **G5a-S3-T3** Changeset redis-rate-limit (@secondlayer/api patch). — validate: changeset status. — deps: G5a-S3-T1 — commit: `chore: changeset Redis rate limiting`

**Open Qs:** fail-open vs closed; existing Redis on prod; ZSET vs INCR; scope all 4; appendonly. (consolidated)
**Risks:** per-request round-trip; no typed eval; Lua RESP coercion; member uniqueness; header byte-match; CI no redis; deploy health gate; singleton reset. (consolidated)

---

## G4 [P1] Split chain onto SOURCE_DATABASE_URL, keep platform/billing on TARGET

Draft premise WRONG: chain writes do NOT already use getSourceDb — indexer ingest + L2 storage write via getDb()==getTargetDb(). Only dataset/streams READERS use getSourceDb. REAL first work = reroute every chain WRITE to getSourceDb FIRST, THEN docker/env, THEN data migration. Dual seam (env.ts, db/index.ts, listener.ts, processor helpers, db-dual.test.ts) already exists; migrate.ts reads only DATABASE_URL (must teach both). Latest migration 0088 => new = 0089.

**Cross-gap:** No hard dep on G1. Any future 3rd billing-DB gap depends on THIS landing. S2-T1 dual-migrate is prereq for any per-DB DDL gap.

### Sprint 1 — Chain WRITE path rerouted to getSourceDb (still single-DB, zero behavior change)
- [ ] **G4-S1-T1** SCHEMA_SPLIT.md: ground-truthed SOURCE/chain set vs TARGET/platform set; flag decoded_* as decision-pending. — validate: every Table in types.ts assigned or flagged. — commit: `docs(docker): SCHEMA_SPLIT source/target table sets`
- [ ] **G4-S1-T2** Reroute CORE ingest writes (index.ts 82/262/369/391, ingest.ts 92, mempool.ts 138, tip-follower.ts 66, persist caller) getDb->getSourceDb. Keep injectable signatures. Changeset @secondlayer/indexer. — validate: indexer tsc; ingest/persist/streams-events tests green. — deps: G4-S1-T1 — commit: `refactor(indexer): route core chain writes to source DB`
- [ ] **G4-S1-T3** Reroute maintenance writes (reorg, integrity, bulk-backfill, repair, backfill-raw-tx, contracts/scheduler, cleanup-reorg-dupes, leader, burn-rewards-storage) to getSourceDb. — validate: grep getDb() returns only intended; reorg+integrity tests; tsc. — deps: G4-S1-T2 — commit: `refactor(indexer): route chain maintenance writes to source DB`
- [ ] **G4-S1-T4** DECISION-GATED (DECODED-SET HOME OQ): align L2 storage writers (l2/storage, sbtc/bns/pox4-storage, health, pox-4 decoder) to getSourceDb IF decoded->SOURCE; else NO-OP + SCHEMA_SPLIT note. — validate: if exec: grep getTargetDb in l2 only intended; l2 tests. — deps: G4-S1-T1 — commit: `refactor(indexer): route decoded writes to source DB` (or doc-only)
- [ ] **G4-S1-T5** Verify readers source-correct (audit-confirm; fix any chain READ on getTargetDb/getDb). — validate: grep api datasets/index reviewed; tsc. — deps: G4-S1-T1 — commit: (only if fix)

### Sprint 2 — dual migrate + 2nd postgres + env rewire + split smoke
- [ ] **G4-S2-T1** migrate.ts dual-DB: deduped set from SOURCE/TARGET/DATABASE_URL; run chain against each distinct url. Single-DB unchanged when only DATABASE_URL. Changeset @secondlayer/shared. — validate: two DBs => kysely_migration in both; only DATABASE_URL => once. — deps: G4-S1-T2 — commit: `feat(shared): dual-DB migrate over source+target`
- [ ] **G4-S2-T2** assertDbSplit() in db/index.ts (warn if prod && source===target); wire into api/worker/indexer/processor entrypoints; extend db-dual.test. Changeset @secondlayer/shared. — validate: db-dual.test green; single-DB prod warns, split silent. — deps: G4-S2-T1 — commit: `feat(shared): assertDbSplit boot guard`
- [ ] **G4-S2-T3** Add postgres-platform service (compose.yml + dev.yml), volume, healthcheck. No env rewire yet. — validate: config valid; both pg healthy. — commit: `feat(docker): add postgres-platform service`
- [ ] **G4-S2-T4** Rewire env across all 3 compose files: SOURCE->postgres, TARGET->postgres-platform per service; migrate depends_on BOTH; leave DATABASE_URL UNSET in split. — validate: api /health; current_database() distinct per getter; processor catch-up. — deps: G4-S2-T1, G4-S2-T3 — commit: `feat(docker): wire source/target DATABASE_URL split`

### Sprint 3 — staging cutover + runbook + rollback
- [ ] **G4-S3-T1** Cutover runbook + split-platform-db.sh: snapshot first, pg_dump --section (FK order), restore platform set into postgres-platform, row-count + FK-closure checks. NEVER `docker compose run migrate` against chain. — validate: dry-run row counts match; no FK orphans. — deps: G4-S2-T4 — commit: `feat(docker): platform-DB split cutover script`
- [ ] **G4-S3-T2** Execute on staging: snapshot, split, flip env, restart safe order (platform migrated FIRST, then api/worker/processor, webhooks-stripe LAST). — validate: auth/api-key/subgraph/stripe-idempotency/worker green; SOURCE 0 accounts, TARGET 0 blocks. — deps: G4-S3-T1
- [ ] **G4-S3-T3** Migration 0089_split_drop_unused: SPLIT_MODE-gated drop empty opposite-set tables per DB; idempotent. Changeset @secondlayer/shared. — validate: SPLIT_MODE on => dropped + app green; off => intact. — deps: G4-S3-T2 — commit: `feat(shared): 0089 split-mode drop unused tables`
- [ ] **G4-S3-T4** Document + dry-run rollback (pre-0089 = re-point TARGET to single; post-0089 = snapshot restore). Gate 0089 behind 24-48h stability window. — validate: staging rollback pre-0089 app green; restore path documented+tested. — deps: G4-S3-T2 — commit: `docs(docker): DB-split rollback + stability gate`

**Open Qs:** DECODED-SET HOME (blocker); intent=isolate chain; DDL strategy; cutover window; remove DATABASE_URL; OSS single-DB. (consolidated)
**Risks:** chain write reroute before split (sequencing); silent fallback; LISTEN/NOTIFY split; 3 compose files; destructive migration; FK order; deploy 502; 0089 irreversible. (consolidated)

---

## G5b [P2] Extract chain-subscription evaluator + outbox emitter into a standalone subscriptions service

Split evaluator+chain-reorg+emitter out of startSubgraphProcessor into a new subscriptions-service.ts boot in the SAME @secondlayer/subgraphs package. NO schema change, NO new package. Files under src/runtime/. API shapes: startTriggerEvaluator/startStreamsReorgPoll return SYNC ()=>void; startEmitter async. Chain-reorg = optional 3rd arg of streams-reorg-poll (subscriptions runs its OWN poll w/ noop subgraph-reorg + real chain handler; processor keeps its w/ no chain arg). TWO-DEPLOY cutover mandatory.

### Sprint 1 — reusable boot fn (nothing wired)
- [ ] **G5b-S1-T1** chain-reorg-poll.ts: startChainReorgPoll() = startStreamsReorgPoll(noopSubgraphReorg, noopLoadDef, handleChainReorg). — validate: subgraphs typecheck; streams-reorg-poll.test green. — commit: `feat(subgraphs): standalone chain-reorg poll`
- [ ] **G5b-S1-T2** subscriptions-runtime.ts: startSubscriptionsRuntime() boots eval+chainReorg (streams-index gated) + emitter; composed stop mixes sync+async. — validate: mock test SUBGRAPH_SOURCE unset => only emitter; set => all 3. — deps: G5b-S1-T1 — commit: `feat(subgraphs): subscriptions runtime composition`
- [ ] **G5b-S1-T3** Add both to bunup.config.ts entries. — validate: build emits both dist files. — deps: G5b-S1-T2 — commit: `chore(subgraphs): bundle subscriptions runtime`

### Sprint 2 — standalone service entrypoint + heartbeat
- [ ] **G5b-S2-T1** subscriptions-service.ts (mirror service.ts; SERVICE_NAME='subscriptions'; heartbeat 30s; SIGINT/SIGTERM await stop()). — validate: local boot logs emitter+evaluator+reorg started; heartbeat row written. — deps: G5b-S1-T2 — commit: `feat(subgraphs): subscriptions service entrypoint`
- [ ] **G5b-S2-T2** Add to bunup.config.ts. — validate: build emits dist/subscriptions-service.js. — deps: G5b-S2-T1, G5b-S1-T3 — commit: `chore(subgraphs): bundle subscriptions service`

### Sprint 3 — deploy ALONGSIDE processor (SKIP-LOCKED overlap)
- [ ] **G5b-S3-T1** Add subscriptions service to docker-compose.yml (clone processor, new command, OMIT views volume). — validate: config parses; service present, no views volume. — deps: G5b-S2-T2 — commit: `feat(docker): add subscriptions service`
- [ ] **G5b-S3-T2** hetzner override: ONLY SUBGRAPH_SOURCE: streams-index (rely on in-code defaults). — validate: merged config shows it. — deps: G5b-S3-T1 — commit: `feat(docker): hetzner subscriptions env`
- [ ] **G5b-S3-T3** status.ts: add subscriptions heartbeat to BOTH allSettled blocks (~180, ~346). — validate: both routes include subscriptions detail/status. — deps: G5b-S2-T1 — commit: `feat(api): surface subscriptions health`
- [ ] **G5b-S3-T4** OSS compose (yml + devnet.yml; devnet SECONDLAYER_ALLOW_PRIVATE_EGRESS=true). — validate: both parse; devnet has egress flag. — deps: G5b-S3-T1 — commit: `feat(docker): oss subscriptions service`
- [ ] **G5b-S3-T5** CLI devnet (devnet-compose.ts clone + SERVICES array + logs help). — validate: cli build; generated compose has subscriptions; logs accepts it. — deps: G5b-S3-T1 — commit: `feat(cli): devnet subscriptions service`
- [ ] **G5b-S3-T6** Changeset 1/2: @secondlayer/subgraphs minor (additive) + @secondlayer/api patch (status). — validate: changeset names both. — deps: G5b-S3-T1, G5b-S3-T3 — commit: `chore: changeset subscriptions service additive`

### Sprint 4 — CUTOVER (separate deploy): processor stops emitter/eval/chain-reorg
- [ ] **G5b-S4-T1** processor.ts: drop handleChainReorg 3rd arg from startStreamsReorgPoll; remove stopTriggerEvaluator, startEmitter, their shutdown calls + unused imports. Keep handleSubgraphReorg + loadDef. — validate: tsc (no unused); subgraphs tests; boot logs subgraph catch-up + reorg poll but NO emitter/evaluator. — deps: G5b-S3-T6 — commit: `refactor(subgraphs): processor cedes emitter/evaluator/chain-reorg`
- [ ] **G5b-S4-T2** Changeset 2/2: @secondlayer/subgraphs patch (processor no longer boots them). — validate: changeset present. — deps: G5b-S4-T1 — commit: `chore: changeset processor cutover`

### Sprint 5 — OPTIONAL latency win (gated on new_block NOTIFY existing)
- [ ] **G5b-S5-T1** OPTIONAL: evaluator wakes on indexer:new_block (single-flight, timer backstop). startTriggerEvaluator becomes async => ripple into subscriptions-runtime. — validate: double-fire => at most one concurrent; existing tests green; runtime test updated. — deps: G5b-S4-T1 — commit: `feat(subgraphs): evaluator wakes on new_block NOTIFY`

**Open Qs:** replica count; fallback emitter; SUBSCRIPTIONS_STALE_MS; new_block NOTIFY exists? (consolidated)
**Risks:** two-deploy ordering (dominant); single op dep post-cutover; dual-DB LISTEN caveat; no subgraph-reorg regression; 2x reorg poll; sync/async stop. (consolidated)

---

## G-blocksrc [P2] Make streams-index the default block source; delete PostgresBlockSource

resolveBlockSource returns PublicApiBlockSource only under SUBGRAPH_SOURCE=streams-index + eligible; else PostgresBlockSource (getSourceDb tap). Flip HTTP to default (reversible via =postgres), then delete PostgresBlockSource + DB-tap loadBlockRange. '*' catch-all handler is SUPPORTED — only remove the filterless _eventId fallback. Array-form sources dead in prod.

**Cross-gap:** Sprint 3 (delete) AFTER G2 ships + confirms no getSourceDb the PROCESSOR relies on. Coordinate S3 major bump w/ batched release.

### Sprint 1 — streams-index DEFAULT (reversible, nothing deleted)
- [ ] **G-blocksrc-S1-T1** define.ts: throw on Array.isArray(sources); array-sources-rejected.test. — validate: test passes; grep 'sources: [' non-test empty. — commit: `feat(subgraphs): reject array-form sources`
- [ ] **G-blocksrc-S1-T2** Invert resolveBlockSource default: PublicApi UNLESS =postgres OR !eligible. Update JSDoc. — validate: subgraphs tsc. — commit: `feat(subgraphs): default to streams-index block source`
- [ ] **G-blocksrc-S1-T3** Add resolveBlockSource unit cases (none today). — validate: block-source.test green. — deps: S1-T2 — commit: `test(subgraphs): resolveBlockSource default cases`
- [ ] **G-blocksrc-S1-T4** Gate reorg-poll + evaluator on !=='postgres' (processor.ts:502,515). — validate: tsc; grep ==="streams-index" empty. — deps: S1-T2 — commit: `feat(subgraphs): gate streams paths on default`
- [ ] **G-blocksrc-S1-T5** hetzner: remove SUBGRAPH_SOURCE: streams-index; document =postgres rollback. — validate: config parses; grep streams-index empty. — deps: S1-T2, S1-T4 — commit: `feat(docker): drop hetzner SUBGRAPH_SOURCE override`
- [ ] **G-blocksrc-S1-T6** Changeset minor @secondlayer/subgraphs. — validate: changeset status. — deps: S1-T2,T4,T5 — commit: `chore: changeset streams-index default`

### Sprint 2 — processor wake-clock source-independent on default path
- [ ] **G-blocksrc-S2-T1** Gate source-DB new_block LISTEN on =postgres (no-op otherwise). — validate: tsc. — deps: S1-T4 — commit: `feat(subgraphs): gate source-DB new_block listen`
- [ ] **G-blocksrc-S2-T2** Gate source-DB subgraph_reorg LISTEN on =postgres. — validate: tsc; default boot logs no source reorg listen. — deps: S2-T1 — commit: `feat(subgraphs): gate source-DB reorg listen`
- [ ] **G-blocksrc-S2-T3** SUBGRAPH_POLL_MS env-tunable (default 5000). — validate: override works; default unchanged. — deps: S2-T1 — commit: `feat(subgraphs): tunable poll interval`
- [ ] **G-blocksrc-S2-T4** Focused test shouldListenSourceDb(env). — validate: processor-listen-gate.test green. — deps: S2-T1, S2-T2 — commit: `test(subgraphs): source-DB listen gate`
- [ ] **G-blocksrc-S2-T5** Changeset patch @secondlayer/subgraphs. — validate: changeset status. — deps: S2-T3, S2-T4 — commit: `chore: changeset source-independent clock`

### Sprint 3 — DELETE PostgresBlockSource (POINT OF NO RETURN; AFTER G2)
- [ ] **G-blocksrc-S3-T1** runner.ts: remove filterless _eventId fallback (both branches 407-420, 449-470); keep '*' resolution. — validate: tsc; tests; grep _eventId empty. — deps: S1-T1 — commit: `refactor(subgraphs): drop filterless event fallback`
- [ ] **G-blocksrc-S3-T2** block-source.ts: delete PostgresBlockSource, postgresBlockSource, isStreamsIndexEligible, getSourceDb+loadBlockRange imports. — validate: tsc; grep empty. — deps: S3-T1, S2-T2 — commit: `refactor(subgraphs): delete PostgresBlockSource`
- [ ] **G-blocksrc-S3-T3** Update block-source.test (drop eligibility; always-PublicApi case). — validate: green. — deps: S3-T2 — commit: `test(subgraphs): block-source HTTP-only`
- [ ] **G-blocksrc-S3-T4** batch-loader.ts: delete loadBlockRange + its imports; KEEP BlockData + avgEventsPerBlock. — validate: tsc; grep loadBlockRange empty. — deps: S3-T2 — commit: `refactor(subgraphs): delete DB-tap loader`
- [ ] **G-blocksrc-S3-T5** Delete bench/db-tap.ts. — validate: tsc; grep db-tap empty. — deps: S3-T4 — commit: `chore(subgraphs): remove DB-tap bench`
- [ ] **G-blocksrc-S3-T6** processor.ts: delete source-DB LISTEN blocks + sourceListenerUrl; remove gate (now unconditional); keep targetListenerUrl. — validate: tsc; grep SUBGRAPH_SOURCE/sourceListenerUrl empty; service boots. — deps: S3-T2, S2-T2 — commit: `refactor(subgraphs): remove source-DB listen path`
- [ ] **G-blocksrc-S3-T7** hetzner: drop SUBGRAPH_SOURCE comment. — validate: config parses; grep empty. — deps: S3-T6 — commit: `chore(docker): drop SUBGRAPH_SOURCE knob`
- [ ] **G-blocksrc-S3-T8** golden-diff -> HTTP-vs-fixture conformance; capture-fixtures decision (snapshot once then rewrite, or delete). — validate: tsc; golden-diff --fixture exits 0. — deps: S3-T2, S3-T4 — commit: `test(subgraphs): fixture-based conformance harness`
- [ ] **G-blocksrc-S3-T9** Update stale prose (block-source header, reindex.ts:337, reconstruct, api/index/auth.ts:81, shared/index-http.ts:11). — validate: grep 'DB tap|opt-in|re-point|PostgresBlockSource' src empty. — deps: S3-T2, S3-T6 — commit: `docs(subgraphs): scrub DB-tap framing`
- [ ] **G-blocksrc-S3-T10** Changeset MAJOR @secondlayer/subgraphs. — validate: changeset status major. — deps: S3-T2, S3-T4, S3-T6 — commit: `chore: changeset delete PostgresBlockSource`

**Open Qs:** runtime-decouple-only scope; two releases; poll latency; golden-diff fate. (consolidated)
**Risks:** referenced-types-only fetch; _eventId stable-key; reorg SPOF; index-tip lag; major bump; getSourceDb 40+ callers untouched. (consolidated)

---

## G7 [P2] Sign the bulk parquet manifest (cold-lane ed25519 attestation parity)

Cold lane: SDK fetches manifest DIRECTLY from R2, verifies per-file sha256, but manifest itself UNSIGNED. Fix = EMBEDDED detached signature field, produced by indexer, verified by SDK over reconstructed canonical bytes. Reuse /public/streams/signing-key. Canonical = stableJsonStringify (sorted keys, no whitespace) hoisted to @secondlayer/shared; indexer DELETES its private copy => byte-identical by construction. STRICT fail-closed order: sign+wire+deploy -> backfill -> then verify:on. STREAMS_SIGNING_PRIVATE_KEY on api but NOT indexer => must add.

### Sprint 1 — shared canonical serializer + sign/verify helpers
- [ ] **G7-S1-T1** shared/streams/manifest-signature.ts: canonicalManifestBytes (strip signature, stableJsonStringify), ManifestSignature type, signManifest, verifyManifestSignature. — validate: shared tsc. — commit: `feat(shared): manifest canonical+sign/verify helpers`
- [ ] **G7-S1-T2** Re-export as `streamsManifest` namespace from shared index.ts. — validate: tsc; import resolves. — deps: S1-T1 — commit: `feat(shared): export streamsManifest namespace`
- [ ] **G7-S1-T3** manifest-signature.test: sign/verify true; mutate sha256 => false; key reorder => identical bytes; schema_version 0 AND 1 both verify. — validate: bun test green. — deps: S1-T1 — commit: `test(shared): manifest signature`

### Sprint 2 — indexer reuses shared serializer + optional sig type
- [ ] **G7-S2-T1** indexer json.ts re-exports shared stableJsonStringify (delete private body). — validate: indexer tsc; exporter.test green. — deps: S1-T1 — commit: `refactor(indexer): reuse shared canonical serializer`
- [ ] **G7-S2-T2** Optional signature field on StreamsBulkManifest (don't emit yet). — validate: tsc; exporter.test. — deps: S1-T1 — commit: `feat(indexer): manifest signature field`

### Sprint 3 — exporter embeds signature (gated on key presence) + smoke
- [ ] **G7-S3-T1** signing.ts: getStreamsBulkSigner() (STREAMS_SIGNING_PRIVATE_KEY, restore \n, load, derive pub, memoize, null when unset) + reset-for-test. — validate: tsc; test env-set keyId match, unset null. — deps: S1-T1 — commit: `feat(indexer): bulk-manifest signer`
- [ ] **G7-S3-T2** exporter: set manifest.signature before all 4 sinks (same object instance); add signed:boolean to result. — validate: signed manifest verifies; disk round-trip verifies; unset => undefined+false. — deps: S2-T1, S2-T2, S3-T1 — commit: `feat(indexer): embed manifest signature on export`
- [ ] **G7-S3-T3** smoke.ts: verify signature if present (throw on mismatch, warn on absent); signed in output. — validate: signed manifest ok+signed:true; unsigned ok+warn. — deps: S3-T2 — commit: `feat(indexer): smoke verifies manifest signature`

### Sprint 4 — provision key to indexer env
- [ ] **G7-S4-T1** docker-compose.yml: add STREAMS_SIGNING_PRIVATE_KEY to indexer env (currently api-only). — validate: config shows it on indexer; confirm prod .env exports it. — commit: `feat(docker): provision signing key to indexer`

### Sprint 5 — SDK verifies (default OFF)
- [ ] **G7-S5-T1** Optional signature on StreamsDumpsManifest. — validate: sdk tsc; dumps.test green. — commit: `feat(sdk): manifest signature type`
- [ ] **G7-S5-T2** dumps.ts accepts verifyKey + verifyEnabled; client.ts adapts existing loadKey/rotation; extend VerificationKey to carry publicKeyPem. — validate: tsc; dumps.test green (no verify path yet). — deps: S1-T1, S5-T1 — commit: `feat(sdk): wire manifest verify resolver`
- [ ] **G7-S5-T3** list(): verifyEnabled => verify signature (keyId rotation refresh-once), throw StreamsSignatureError on mismatch/absent; OFF => skip. — validate: signed ok; mutated => error; absent+enabled => error; OFF+unsigned ok. — deps: S5-T2 — commit: `feat(sdk): fail-closed manifest verify`
- [ ] **G7-S5-T4** JSDoc on verify option + list(). — validate: tsc; sdk test. — deps: S5-T3 — commit: `docs(sdk): verify covers bulk manifest`

### Sprint 6 — API proxy type honesty + changesets + QA
- [ ] **G7-S6-T1** Optional signature on API StreamsBulkManifest + comment at status.ts:304 (no re-sign; field survives c.json). — validate: api tsc; dumps.test. — deps: S3-T2 — commit: `feat(api): manifest type carries signature`
- [ ] **G7-S6-T2** 4 changesets: shared minor, indexer minor, sdk minor, api patch. — validate: changeset status. — deps: S1-T1, S3-T2, S5-T3, S6-T1 — commit: `chore: changesets sign bulk manifest`
- [ ] **G7-S6-T3** Full QA gate across touched packages. — validate: /check green; bun test all. — deps: all S1-S6.

### Sprint 7 — backfill (AFTER S3-S4 deployed, BEFORE verify:on)
- [ ] **G7-S7-T1** resign-manifests.ts one-shot: list R2 manifests, sign unsigned, putJsonObject; idempotent; --apply required. — validate: tsc; unit (1 unsigned signed, 1 signed skipped); prod dry-run then --apply then 0 remaining. — deps: S3-T1, S4-T1 — commit: `feat(indexer): backfill re-sign historical manifests`

**Open Qs:** embedded vs sidecar; same key cold+live; verify default; backfill scope; external verify:true consumers. (consolidated)
**Risks:** canonicalization drift; fail-closed order; missing infra key; key exposure; rotation; schema_version. (consolidated)

---

## G-txreorg [P2] Tx-cursor-addressable reorg reader for /v1/index/transactions (+/contract-calls)

/transactions hardcodes reorgs:[] (type reorgs:never[]); /contract-calls same but type ALREADY StreamsReorg[]. Event endpoints populate via 2D (height,event_index) keyset; tx cursor is (height,tx_index) — incomparable => stubbed. FIX: a reorg orphans whole HEIGHTS => height-only interval overlap; tx_index irrelevant. Add readChainReorgsForHeightRange + StreamsReorgsHeightReader seam + readReorgsForTxPage. Index chain_reorgs_orphaned_range_idx leads orphaned_from_height => sargable, NO new migration. Route discovery ALREADY advertises reorgs[] => live API lying.

**Cross-gap:** S1 before any API wiring. INSENSITIVE to G3 (height-only, ignores event_index) — argues FOR height mapping. S3-T4 audit reconcile AFTER code ships.

### Sprint 1 — shared height-range query + DB-integration test
- [ ] **G-txreorg-S1-T1** chain-reorgs.ts: readChainReorgsForHeightRange(fromHeight,toHeight) — WHERE orphaned_from_height<=toHeight AND orphaned_to_height>=fromHeight, ORDER detected_at,id; normalizeRow; db ?? getSourceDb(). — validate: shared tsc; grep present. — commit: `feat(shared): height-range chain-reorgs reader`
- [ ] **G-txreorg-S1-T2** chain-reorgs.test (DB-integration, real Postgres; NOT stub/SQL-string): seed via insertChainReorg, assert ids for inside/straddle-lower/straddle-upper/below/above/exact-touch cases. — validate: DATABASE_URL+migrations => bun test green. — deps: S1-T1 — commit: `test(shared): height-range reorg overlap`
- [ ] **G-txreorg-S1-T3** Changeset tx-reorg-height-range (@secondlayer/shared minor). — validate: changeset status. — deps: S1-T1 — commit: `chore: changeset height-range reorg reader`

### Sprint 2 — /transactions populates reorgs[]
- [ ] **G-txreorg-S2-T1** reorgs.ts: StreamsReorgsHeightReader type + EMPTY + DEFAULT (=readChainReorgsForHeightRange). — validate: api tsc. — deps: S1-T1 — commit: `feat(api): height-range reorg reader seam`
- [ ] **G-txreorg-S2-T2** _shared.ts: readReorgsForTxPage(txs, reader?) — first/last block_height -> reader range; EMPTY default. — validate: api tsc. — deps: S2-T1 — commit: `feat(api): tx-page reorg resolver`
- [ ] **G-txreorg-S2-T3** transactions.ts: reorgs type never[]->StreamsReorg[]; opts.readReorgs; replace final reorgs:[] (L401) with await readReorgsForTxPage; KEEP cursorPastTip []. — validate: api tsc. — deps: S2-T2 — commit: `feat(api): populate /transactions reorgs`
- [ ] **G-txreorg-S2-T4** transactions.test: rename always-[] test; add injected-reader maps-through, empty-page (reader not called), cursorPastTip []. — validate: bun test green. — deps: S2-T3 — commit: `test(api): /transactions reorgs`
- [ ] **G-txreorg-S2-T5** routes/index.ts: DEFAULT_STREAMS_REORGS_HEIGHT_READER, IndexRouterOptions.readReorgsForTx, pass to /transactions handler. applyIndexCache + description unchanged. — validate: api tsc; routes + routes-cache tests. — deps: S2-T3 — commit: `feat(api): wire /transactions reorg reader`
- [ ] **G-txreorg-S2-T6** Changeset api-tx-reorgs (@secondlayer/api patch). — validate: changeset status. — deps: S2-T3 — commit: `chore: changeset /transactions reorgs`

### Sprint 3 — /contract-calls parity (GATED on SCOPE OQ) + audit reconcile
- [ ] **G-txreorg-S3-T1** GATED YES: contract-calls.ts: opts.readReorgs; replace reorgs:[] (L319) with readReorgsForTxPage; type already StreamsReorg[]; KEEP cursorPastTip []. If NO: comment-only. — validate: api tsc. — deps: S2-T2 — commit: `feat(api): populate /contract-calls reorgs`
- [ ] **G-txreorg-S3-T2** GATED YES: routes/index.ts /contract-calls handler pass readReorgs. — validate: api tsc; routes.test. — deps: S3-T1, S2-T5 — commit: `feat(api): wire /contract-calls reorg reader`
- [ ] **G-txreorg-S3-T3** GATED YES: contract-calls.test mirror S2-T4. — validate: bun test green. — deps: S3-T1 — commit: `test(api): /contract-calls reorgs`
- [ ] **G-txreorg-S3-T4** Reconcile audit artifacts AFTER code (data-plane-audit.md ~101/110/128 resolved; infrastructure-audit.html factual reorg cells ONLY, no restyle). — validate: claims match shipped code. — deps: S3-T2, S2-T5 — commit: `docs(audit): reorg coverage resolved`

**Open Qs:** INTENT fix vs doc-only (blocker); scope /contract-calls; height-only semantics acceptable. (consolidated)
**Risks:** over-inclusive (never under-reports); cache fullyFinalized; S1-T2 needs migration 0068; event-index cursors unusable by tx consumers; infra-audit.html WIP-as-canon. (consolidated)

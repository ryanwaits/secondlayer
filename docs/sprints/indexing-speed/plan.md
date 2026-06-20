# Indexing speed — make reindex fast for every tier

Indexing IS the product; today a full-history sparse reindex is ~16h. Make it minutes, for
free/self-host AND paid tiers. Source: `docs/internal/audits/reindex-performance-2026-06-20.md`.

**Measured baseline:** 27 blk/s active region → ~16h sBTC; empty blocks ~54k blk/s (sparse-scan).
**Targets:** sBTC 5–10 min, pox 20 min (~100× today).

**⚠ Root cause is NOT known — and the audit's first guess is likely wrong.** The subgraph reindex
reads `decoded_events`, indexed on `(contract_id, block_height, event_index)` (mig 0066); the
`/v1/index/events` query filters those indexed columns — **no jsonb scan** (that was a different
streams-print path). So the "100× needs R2" framing is UNPROVEN. Sprint 1 profiles before we build;
Sprint 3 only runs if the HTTP path genuinely can't hit target after Sprints 1–2.

---

## Sprint 1 — Diagnose + universal quick wins  ★ HIGHEST LEVERAGE (every tier, no new data plane)

Demoable: a measured throughput jump on the existing HTTP path that every tier (incl. self-host) gets free.

- [ ] **T0 Add per-reindex throughput metrics** (blk/s, events/s, per-phase wall-time: fetch vs
  handler vs flush/commit) to `block-processor.ts`/`reindex.ts`, logged + queryable. → validates:
  a running reindex emits live throughput without re-deriving from row counts (how this audit was
  made by hand). Cheap; makes every later validation trivial.
- [ ] **T1 ★ Profile a live reindex (do FIRST).** With T0's metrics + `EXPLAIN ANALYZE` on
  `firstEventHeight`/`walkBlocks`/`walkTransactions`/`walkEvents` over a real dense range, answer the
  branch question: **fetch-bound, scan-bound, or write/commit-bound?** → validates: committed timing
  breakdown naming the 27 blk/s culprit. (If commit/lock-bound, Sprint 2's parallel *fetch* won't
  help — re-plan.)
- [ ] **T2 ★ Skip `walkTransactions` for event-only subgraphs — likely the cheapest big win.**
  sBTC/BNS sources are event-type (`canSparseScan` true) and discard tx-level data, yet
  `block-source.ts:202` runs `Promise.all([walkBlocks, walkTransactions, walkEvents])` every batch —
  one of three parallel calls is pure waste. Gate it off when no source is tx-level. → validates:
  event-only reindex issues zero `/v1/index/transactions` calls; throughput re-measured (T0) higher.
- [ ] **T3 Tune backfill batch size.** Raise `SUBGRAPH_REINDEX_BATCH_SIZE` (500→750/1000), confirm
  adaptive growth on sparse ranges, stay under the 5–10s socket-timeout window. → validates: blk/s
  up on a fixed 200k-block range, no timeouts.
- [ ] **T4 (spawned by T1) Close any index/query gap T1 surfaces.** → validates: `EXPLAIN` shows
  index scan, not seq scan, on the offending query. Scope = whatever T1 finds (0–N commits).

## Sprint 2 — Parallel block-range workers  ★ HIGH LEVERAGE (Nx, every tier, no new data plane)

Demoable: an N-worker reindex finishing ~Nx faster than serial, with identical rows.
**Entry gate:** only if T1 shows the path is fetch/scan-bound (not write/commit-bound).

- [ ] **T5a Partition + N workers over FINALIZED history only.** Split `[startBlock, tip −
  reorg_margin]` into N ranges, process concurrently; the tail stays serial/live (reorg-safe — N
  writers + a reorg is undefined against the per-asset hard-delete handlers, commit `2045a664`).
  → validates: N-worker reindex ≈ Nx on a 500k finalized-block range.
- [ ] **T5b Write-path partition-safety (BLOCKER — gates which tables parallelize).** insert-only
  tables (events/deposits/actions) and commutative `ctx.increment` accumulators (cycles, summary
  counts) are parallel-safe; **order-dependent `upsert` projections are NOT** (parallel out-of-order
  ranges can let an earlier block's write clobber a later one — e.g. `withdrawals` status,
  `delegations`, pox `stackers`). Add a `_block_height`-guarded upsert (overwrite only if newer) OR a
  serial projection post-pass. → validates: a withdrawals/delegations table reindexed in parallel ==
  the serial result (compare on the natural key, not row order; exclude auto/journal columns).
- [ ] **T5c Checkpoint merge + crash-resume.** Per-range cursors, out-of-order completion, and
  resume-only-the-failed-window (not restart-all) if worker k dies. → validates: kill a worker
  mid-run → only its window re-runs → final rows complete + correct.
- [ ] **T5d Live-tail handoff.** Reconcile the parallel finalized backfill into the live walk with no
  gap and no double-process at the seam. → validates: no missing/duplicate rows at the boundary
  block; supply-conservation guard (prod-smoke) passes.
- [ ] **T6 Per-tier worker-count cap, wired into the heavy-op budget (PROD-GATE for T5).** free/
  self-host=1, Pro=small, Scale=larger, Ent=largest; bounded by `SUBGRAPH_HEAVY_OP_BUDGET`. Must land
  before T5 parallelism is enabled in prod (else unbounded contention). → validates: tier flag sets
  worker count; total concurrency still bounded.

## Sprint 3 — R2 parquet fast-lane  (paid differentiator; biggest single speedup; GATED)

**Entry condition:** Sprint 1+2 re-measure shows the target is genuinely unreachable on the HTTP path.
Do NOT build a new data plane for a 3–10× problem the HTTP path already solves.
**Hard dep (no internal owner):** genesis dump backfill — ROADMAP P2 "Dump history back to chain
genesis" (dumps floor ~7.81M; must reach block 1 to cover sBTC 6.8M–7.81M) AND `replay()` reading
sub-7.81M correctly.

- [ ] **T7 R2 parquet reindex source.** Read dump windows by range, filter to source contract(s),
  feed the handler pipeline (reuse `replay()`). → validates: a subgraph reindexes from R2, rows ==
  HTTP path, throughput ≥ thousands of events/s.
- [ ] **T7b Fast-lane correctness gate + rollback.** R2 decodes in-worker — a *different* path than
  the live indexer; decoder-version skew could silently corrupt a paid customer's subgraph. Reconcile
  R2-path output vs HTTP spot-check + supply-conservation (prod-smoke guards already exist); document
  rollback (drop schema, re-run HTTP). → validates: a deliberately stale-decoder dump is caught + refused.
- [ ] **T8 Tier-gate R2 + HTTP fallback.** Scale/Ent → R2; free/Pro → faster HTTP. → validates: tier
  flag selects source; killing a dump window exercises the fallback.
- [ ] **T9 Re-measure + publish per-tier reindex SLOs** (status page + docs). → validates: sBTC <10
  min on Scale path; SLO table shipped.

---

## Highest-leverage summary
1. **T1+T2** — profile, and skip `walkTransactions` (confirmed-real, nearly free, possibly most of the win).
2. **T5a–d (parallel workers)** — biggest universal win, no new data plane; but T5b/T5c/T5d are real
   correctness work, not a one-commit task.
3. **T7 (R2)** — biggest single speedup + paid differentiator, gated on the dump backfill AND on
   Sprint 1–2 proving the HTTP path insufficient.

Tier philosophy: data stays open/keyless; **backfill _speed_ is the paid lever.** Free/self-host
(MIT) gets Sprints 1–2 (same OSS code); only the R2 fast-lane is hosted-tier.

## Unresolved questions
1. Per-tier worker caps — founder pricing call.
2. R2 source: raw-event parquet + in-worker decode, or pre-decoded dumps? (decoder-skew risk — see T7b.)
3. Meter the one-time backfill by block-span × tier-rate, or bundle into the flat tier?
4. Free/paid line: free gets parallel workers (MIT) but not hosted R2 dumps — intended?
5. Branch on T1: if write/commit-bound, Sprint 2 changes from parallel-fetch to batched-writes — re-plan.

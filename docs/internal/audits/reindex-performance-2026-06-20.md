# Reindex / indexing performance — analysis + tiered acceleration plan

2026-06-20. Grounded in live measurement of the in-flight `sbtc-flows` + `bns-names` reindexes.

## TL;DR

Current full-history reindex of a sparse contract is **~16 hours** (sBTC). **Root cause is NOT yet
confirmed** — see the correction below; an early guess (a jsonb scan) is likely wrong for the
subgraph path, so the "needs R2" conclusion is unproven until profiled. The targets (sBTC ~5–10 min,
pox ~20 min) are ~100× today. Likely levers, cheapest first: **(1)** skip the wasted
`walkTransactions` call for event-only subgraphs, **(2)** **parallel block-range workers** (Nx, no new
data plane), **(3)** the **R2 parquet** fast-lane (biggest, but gated on the genesis dump backfill and
on proving the HTTP path insufficient). Plan: `docs/sprints/indexing-speed/plan.md`.

## Measured baseline (live, 2026-06-20)

| Regime | Throughput | Evidence |
|---|---|---|
| Empty pre-contract blocks (sparse-scan jump) | **~54,000 blk/s** | sbtc-flows cleared 328k→6.8M (6.47M blocks) in ~2 min |
| Active region (events present) | **~27 blk/s** | 4,982 blocks in 181s, sampled at height ~7.09M |
| Writes | not the bottleneck | +0 deposits, +~tens of events in the 181s window — time went to scanning, not inserting |

- **sBTC full reindex ≈ 16h** (active region 6.8M→8.35M ≈ 1.55M blocks ÷ 27 blk/s ≈ 16h; live ETA
  agreed: ~13h remaining from 1.25M behind).
- **pox-stacking will be worse**: `contract_call` sources **can't sparse-scan** (sparse-scan is
  event-type only — `block-source.ts:canSparseScan`), so pox walks `/v1/index/transactions` across
  all 8.2M blocks with no fast-skip.

## Where the time goes

The runtime (`PublicApiBlockSource`) pulls from the **Index HTTP API**, **serially**, in adaptive
100–1000 block batches. Per batch it runs `Promise.all([walkBlocks, walkTransactions, walkEvents])`.

**Correction (post-review):** the event read hits `/v1/index/events`, which queries `decoded_events`
on `event_type` + `block_height` range + `contract_id IN (...)` — all covered by the
`(contract_id, block_height, event_index)` index (mig 0066). **It is NOT the unindexed
`data->>'contract_identifier'` jsonb scan** — that lives in a *different* path (the streams-print
query the BNS decoder uses). So the original jsonb diagnosis here was wrong for the subgraph path, and
the 27 blk/s cause is **unconfirmed**. Leading suspects, to be settled by profiling (plan Sprint 1):

- **Wasted `walkTransactions`** — event-only subgraphs (sBTC/BNS) run it every batch for tx-level data
  they discard (one of three parallel HTTP calls, pure overhead).
- **Serial batches** — zero parallelism across the ~1.5M active blocks.
- **Per-batch round-trip + flush/commit** overhead, or the sparse-probe cost — needs `EXPLAIN ANALYZE`
  + per-phase timing to attribute (could be fetch-, scan-, or write/commit-bound; the fix branches on
  which).

## T1 RESULT — root cause CONFIRMED (2026-06-20, measured with a paid key)

Black-box timing of the three per-batch source calls over a 1000-block dense range [8.300M–8.301M]:

| call | rows | time |
|---|---|---|
| `walkTransactions` (ALL txns, unfiltered) | 10,000+ (didn't finish in 10 pages) | **41+ s** |
| `walkEvents` (print + sbtc-registry, filtered/indexed) | 164 | 2.0 s |
| `walkBlocks` | ~200/page | fast |

**It is fetch+iterate-bound on `walkTransactions`, NOT scan- or write-bound.** A 1000-block batch
≈ 43s ≈ **23 blk/s — matches the measured 27 blk/s.** The reindex drains *every transaction* in each
range (`walk()` paginates the full range) and `matchSources` iterates all of them to find the ~164
that carry an sBTC event — ~98% pure waste for an event-only subgraph. **Removing the over-fetch is a
~20× lever** (sBTC ~16h → ~1h; still short of 5–10 min, but the dominant single fix).

**But it is NOT a simple skip.** `source-matcher.ts` is *transaction-driven* (`for (const tx of
transactions) eventsByTx.get(tx.tx_id)`), so feeding it `txs=[]` matches **zero events** — naive T2
silently produces an empty subgraph. The real fix re-scopes T2 (below).

## Targets vs reality

| | Today | Target | Gap |
|---|---|---|---|
| sBTC full | ~16h | 5–10 min | ~100–190× |
| pox full | worse (no sparse-scan) | ~20 min | >100× |

Not a tuning problem. Tuning levers (bigger batches, jsonb index, dropping `walkTransactions` for
event-only subgraphs) buy maybe 3–10×; the target needs ~100×.

## Acceleration levers (ranked by leverage)

1. **R2 bulk-dump direct read (the big one).** We already export signed **parquet by block-range
   window** to R2 (`packages/indexer/src/streams-bulk/`). Reading parquet sequentially + filtering
   client-side eliminates the `jsonb` scan entirely — bulk-throughput becomes download + parse +
   handler, i.e. thousands of events/sec. sBTC's ~17k events become a **seconds-to-minutes** job.
   **Blocker:** dumps currently floor at ~7.81M (42 windows); they don't cover 6.8M–7.81M of sBTC
   history. Finishing the **genesis dump backfill** (ROADMAP P2 "Dump history back to chain genesis")
   is the enabler. The `replay()` seam already reads dumps — wire the subgraph reindex source to it.
2. **Parallel block-range workers.** Reindex is serial. Partition the range into N windows and run N
   workers (the data is immutable history — embarrassingly parallel). 8 workers ≈ 8×, stacks on top
   of R2.
3. **Fix the `jsonb` index (HTTP-path stopgap).** A proper index on the event contract predicate (or
   a materialized `(contract_id, block_height)` lookup) turns 5–10s scans into ms. Helps the free /
   self-host path without R2.
4. **Trim per-batch work.** Event-only subgraphs (sBTC/BNS) don't need `walkTransactions`; skipping
   it removes a full scan per batch. Raise default batch size for immutable backfill.

## Tiered product mapping

The asset is real: **we already hold all the decoded history + R2 dumps.** Turn "how fast we let you
read it" into the tier ladder.

| Tier | Reindex path | Experience |
|---|---|---|
| **Free / self-host (MIT)** | HTTP source + jsonb-index fix (lever 3) | works, hours for deep history |
| **Pro $80** | HTTP + parallel-range workers (lever 2) + trimmed batches | meaningfully faster; minutes-to-an-hour |
| **Scale $300** | **R2 parquet direct-read + parallel workers** (levers 1+2) | "lightning fast" — sBTC ~5–10 min, pox ~20 min |
| **Enterprise** | dedicated worker pool / higher parallelism / priority dump access | fastest, SLA'd |

This is honest "usage acceleration," not a paywall on the data (the data stays open/keyless to read;
the *backfill speed* is the paid lever). Fits the charter + the usage-pricing direction (meter the
heavy one-time backfill job, give paying tiers the fast lane).

## Feasibility verdict

- **sBTC 5–10 min: reachable** with R2 direct-read + modest parallelism (4–8 workers), *once dumps
  are genesis-backfilled*. ~17k events over pre-materialized parquet is minutes, not hours.
- **pox 20 min: reachable** the same way — pox has more actions (old stub had 16,749 from 5.14M
  alone; full history likely 100k–500k calls), but parquet read + parallel workers absorbs it. It
  also *needs* lever 1 most, since it can't sparse-scan the HTTP path at all.
- **Without R2 + parallelism: not reachable.** jsonb-index + batch tuning alone caps around 3–10×
  (hours → tens of minutes), short of target.

## Recommended build order

1. **Genesis dump backfill** (unblocks everything; already a ROADMAP item) + an index on the event
   contract predicate (immediate HTTP-path win, helps everyone).
2. **Parallel block-range reindex workers** (Nx, no new data plane).
3. **R2 parquet reindex source** behind a tier flag — wire `replay()`-style dump reads into the
   subgraph backfill path; gate on Scale/Enterprise.
4. Re-measure against the targets; publish reindex-time SLOs per tier.

## Open questions

- Per-tier parallelism caps (worker count) + the heavy-op budget interaction (today budget=2 total).
- Does R2 read need the dumps decoded, or raw-event parquet + in-worker decode? (raw + decode keeps
  dumps generic.)
- Meter model: charge the one-time backfill by block-span × tier-rate, or bundle into the flat tier?

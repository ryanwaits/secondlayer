# Reindex / indexing performance — analysis + tiered acceleration plan

2026-06-20. Grounded in live measurement of the in-flight `sbtc-flows` + `bns-names` reindexes.

## TL;DR

Current full-history reindex of a sparse contract is **~16 hours** (sBTC), bottlenecked by the live
`jsonb` scan on the Index HTTP source — **not** write throughput. The targets (sBTC ~5–10 min, pox
~20 min) are **~100× faster** than today and are **not reachable by tuning** — they need an
architectural change: read our **R2 parquet bulk dumps** (pre-materialized, no scan) + **parallel
block-range workers**. That same capability is the natural **paid-tier differentiator**.

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
The event read is a **poorly-indexed `jsonb` predicate** on `data->>'contract_identifier'` — the code
itself notes "not well-indexed; limit 500 reliably hits 5–10s." So:

- The **scan**, not the transport, is the cost. This is why the repo's "direct-DB tap gave no
  speedup" note holds *and* why HTTP feels slow — both hit the same scan.
- Once events appear, the **sparse-scan probe** hops short distances, paying a slow scan per hop →
  the 27 blk/s collapse in the active region.
- Serial batches mean zero parallelism across the 1.5M active blocks.

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

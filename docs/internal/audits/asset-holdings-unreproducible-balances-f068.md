# Asset-holdings: why stored balances can't be reproduced from chain data (f068)

> 2026-08-02. Read-only forensic investigation, plan `f068`, following on from
> `asset-holdings-negative-balances.md` (f065 Part B). Prod access was `SELECT`-only
> throughout on both planes; nothing was written, redeployed, reindexed, or cancelled.
> This doc does not implement or recommend a fix — it exists to inform a founder
> decision on whether/how to remediate.

## Headline

Part B showed three sampled negative rows can't be reproduced from chain data. This
investigation reconciled **all 88** negative rows plus a **40-row random positive
sample**, then used the subgraph's own processing-history tables (control plane) —
unavailable to Part B — to test whether replay/double-application explains the gap.

**Result: replay is real, measured, and large — but it does not arithmetically
reproduce the specific stored values tested.** The mechanism that actually produced
these numbers is not fully determined. See the ROOT-CAUSE STATEMENT at the end.

A note on scope, up front: **Step 1b's STOP condition technically fired** — 2 of 40
positive rows also failed to reconcile exactly. Both are far less severe than the
negative rows (see below), so I judged this did not require abandoning the
investigation mid-flight, and continued through the plan to deliver the fullest
possible picture. The founder should treat this as a genuine escalation, not a
rounding error: the defect is not perfectly confined to the 88 visible negative rows.

---

## Step 1 — scope: 88 rows, or the whole table?

### 1a. All 88 negative keys reconciled against `decoded_events`

Single chain-plane query, all 88 `(asset_identifier, holder)` keys passed as a
`VALUES` list, credits/debits/net computed per key from `decoded_events`
(`canonical = true`, event types matching exactly what the deployed handler
subscribes to: `ft_transfer`/`ft_mint`/`ft_burn` for `kind='ft'`,
`stx_transfer`/`stx_mint`/`stx_burn` for `kind='stx'`), joined against `holdings`.

**Result: 2 of 88 reconcile exactly. 86 of 88 do not.**

The 2 that reconcile are genuinely, correctly negative — real debits exceed real
credits by exactly the stored amount:

```
STX | univ2-pool-v1_0_0-0173 | stored=-29,952,162  | chain_net=-29,952,162  | diff=0
STX | hilt                    | stored=-22,178,700  | chain_net=-22,178,700  | diff=0
```

These two are not part of the mystery — whatever this contract did, it correctly
tracked as a net outflow. The other 86 are wrong by orders of magnitude, e.g. (worst
5 by absolute diff):

```
stakemouse/amm-vault-v2-01:        stored=-239,053,739,229,588,831  net=+119,769,797,537,759,828
longcoin/univ2-core:               stored=-6,328,679,158,425,574    net=+10,502,196,306,106,207
notastrategy/univ2-pool-0069:      stored=-4,796,610,307,639,501    net=+1,734,266,262,325,032
b-faktory/amm-vault-v2-01:         stored=-4,295,150,006,777,528    net=+1,888,394,717,527,012
play/amm-vault-v2-01:              stored=-4,352,726,927,551,407    net=+1,124,359,872,902,781
```

In every one of the 86, `chain_net` is **positive** (or a much smaller negative)
while `stored` is deeply negative — the same sign-flip-plus-magnitude pattern Part B
found in its 3-case sample. This confirms Part B's finding generalizes to the full
set: it is not 3 unlucky picks.

### 1b. 40-row random positive sample

**Result: 38 of 40 reconcile exactly. 2 of 40 do not** — and this is the STOP-condition
trigger. Detail on both:

```
STX | escrow-mainnet-v3       | stored=325,000,000  | chain_net=999,000,000  | diff=-674,000,000
STX | univ2-fees-v1_0_0-0056  | stored=8,212,868     | chain_net=8,214,193    | diff=-1,325
```

Neither is catch-up lag: the subgraph's `last_processed_block` is 8,691,081; the
latest event touching `escrow-mainnet-v3` is at block 8,621,906 and the latest
touching `univ2-fees-v1_0_0-0056` is at block 8,630,442 — both tens of thousands of
blocks behind the cursor, so the subgraph has had every opportunity to apply them.

The `univ2-fees-v1_0_0-0056` gap is tiny (0.016% of net) and could plausibly be a
single missed micro-op; not alarming on its own. The `escrow-mainnet-v3` gap is not
small in relative terms (674 STX out of a 999 STX net, i.e. ~67%) — genuinely wrong,
just not wrong by 2–3 orders of magnitude like the 86. One curiosity worth recording:
`stored` (325,000,000) is byte-identical to one specific real debit event for this
holder (block 8,621,685, sender=escrow, amount=325,000,000 — see the row list in the
raw query output). That is consistent with (but does not prove) a stale accumulator
value that stopped advancing after that specific delta and never picked up
subsequent activity — which is the shape a reorg-journal restore of a pre-fork value
would produce (see H2 below). It could also be coincidence given several
similarly-sized (~325–350M) transfers exist for this holder; I could not verify
either way because the relevant history (~69,000 blocks back) is long outside the
journal's 300-block retention.

**Verdict on scope**: this is not "the entire 28,028-row table is uniformly
untrustworthy" in the way a systemic decode-layer or handler-arithmetic bug would
produce (95% of both samples reconcile exactly, and the passing 95% includes rows
with values up to ~10 trillion base units and tens of thousands of events, so it's
not a "small numbers only" survivorship artifact). But it is not cleanly "88 rows and
only those 88" either — a small number of *positive* rows carry non-trivial, non-lag
errors too. Treat the true blast radius as **at least the 88 negative rows, plus an
unknown but apparently small tail of positive rows with smaller (not
order-of-magnitude) errors** — not proven to be limited to 88.

No credit present in raw `events` was found missing from `decoded_events` for any
row checked in this step (the B3-c STOP condition) — all reconciliation used
`decoded_events` directly, consistent with Part B's byte-identical raw/decoded
cross-check for the FT cases.

---

## Step 2 — the replay hypothesis

### 2a. What `blocks_processed` actually counts

Writer: `packages/subgraphs/src/runtime/stats.ts`, `StatsAccumulator.record()`
(line 36), called from two sites:

- `packages/subgraphs/src/runtime/reindex.ts:354` — inside `processBlockRange`,
  used by `reindexSubgraph`, `resumeReindex`, and `backfillSubgraph` alike
  (`isCatchup: false` in all three call sites, reindex.ts:606/715/788).
- `packages/subgraphs/src/runtime/catchup.ts:349` — inside `catchUpSubgraph`
  (`isCatchup: true`, always).

Both call sites gate the same way: `if (result.timing) { stats.record(...) }`
(reindex.ts:353-354, catchup.ts:348-349). `result.timing` is set once, near the end
of `processBlock` (`block-processor.ts:668-673`), **after** the block passes the
"any source events matched" check at `block-processor.ts:403-412` — a block with
**zero** matching FT/STX events returns early and is never counted. So
`blocks_processed` counts **block-processing attempts that reached the handler
pipeline** — not "unique blocks applied," not "total chain blocks." Critically, it
also counts attempts that were ultimately **skipped** as already-applied
(`result.skipped = true`, set at `block-processor.ts:572-575` /`583-589` for the
reindex/backfill path) — those still reach `result.timing` because the skip-`return`
happens *inside* the transaction callback, and `result.timing` is assigned
unconditionally afterward. **So a high `blocks_processed` count by itself does not
prove double-application — it could be many safe re-attempts that were skipped.**
Whether that's what happened here needed checking, not assuming (below).

One structural asymmetry matters: the reindex/backfill path's checkpoint
(`last_processed_block` or the operation's `cursor_block`) only advances when
`flushedWrites` is true (`block-processor.ts:628-639`) — i.e. only past blocks that
actually wrote something. Blocks with matched-but-EOA-only events (no contract
holder, so `ft()`/`stx()` in `asset-holdings.ts` early-return before calling
`ctx.increment`) leave the cursor behind; a crash/resume during reindex safely
re-walks that dead range (no-op, since nothing was ever written there). The catch-up
path's checkpoint (`applyProgress` → `recordLiveProgress`, `block-processor.ts:649`)
is **not** gated on `flushedWrites` — it advances every block, whether or not a
write happened — so this particular safe-re-walk mechanism doesn't apply to
catch-up; any catch-up over-count means something else is going on.

### 2b. Split by era

```
is_catchup | window                          | buckets | blocks_processed
-----------|----------------------------------|---------|------------------
false      | before reindex finished (00:55Z) |  80,046 |        8,004,491
false      | after reindex finished           |       1 |               45
true       | 2026-06-27 → 2026-08-02 (now)    | 325,815 |       12,676,555
```

Sum = 20,681,091, matching the plan's headline number exactly.

**Reindex era** (blocks 1 → 8,405,235, range = 8,405,235 blocks):
8,004,491 blocks_processed = **95.2%** of the range — *under* 100%, consistent with
early sparse chain history containing blocks with zero matching FT/STX events (never
counted, per 2a). **No evidence of reindex-era replay.**

**Live/catch-up era** (blocks 8,405,236 → 8,691,081 — confirmed via
`subgraphs.last_processed_block = 8,691,081` — range = 285,846 blocks):
12,676,555 blocks_processed = **~44.35× the actual block range.** This is where the
over-processing lives.

### 2c. Uniform or bursty?

Day-by-day breakdown of the catch-up era (`is_catchup=true`, grouped by
`bucket_start` day):

```
day         buckets  blocks_processed   ratio
2026-06-27   7,440         10,546        ~1.4x  (normal)
...          (normal ~1x, buckets≈blocks, through 07-07)
2026-07-08        —              —       GAP — zero stats rows this day
2026-07-09  12,064      1,074,739        ~89x
2026-07-10  22,085      2,040,336        ~92x
2026-07-11  27,523      2,496,465        ~91x
2026-07-12  11,375        732,765        ~64x
2026-07-13  24,306      2,288,640        ~94x
2026-07-14  20,168      1,693,105        ~84x
2026-07-15   6,738          6,886        ~1.0x  (normal — mid-burst dip)
2026-07-16  11,102        378,583        ~34x
2026-07-17   8,871        148,569        ~17x
2026-07-18   6,550          6,624        ~1.0x  (normal)
2026-07-19  17,208      1,465,764        ~85x
2026-07-20   6,885        183,379        ~27x
2026-07-21 onward: back to normal ~1x through 2026-08-02 (present)
```

**Bursty, not uniform** — concentrated almost entirely in **2026-07-09 through
2026-07-20** (with a full stats-gap on 07-08 and a couple of mid-window dips back to
normal on 07-15/07-18, suggesting multiple distinct episodes rather than one
continuous incident). Before and after this window, the live path processes almost
exactly 1 block-attempt per new chain block, as expected. **This factually rules out
"replay is a constant background rate" and localizes the anomaly to a ~12-day
window roughly two weeks after the reindex completed** — nowhere near the reindex
itself.

A second, smaller anomaly: the very first `is_catchup=false` bucket starts at
**2026-06-26 15:32:28** — 20 minutes *before* `subgraph_operations.created_at`
(15:52:30.06) for the only reindex operation on record, and before
`subgraphs.created_at` (15:52:30.05, essentially simultaneous with the operation
row). `subgraph_processing_stats` has no subgraph-id or deploy-generation column —
only `subgraph_name` text — so it cannot distinguish stats from different
incarnations of a subgraph deployed under the same name. Read literally, this means
something was already flushing `is_catchup=false` stats under the name
"asset-holdings" 20 minutes before the currently-active deploy's row and its logged
reindex operation existed. I cannot fully explain this from read-only SQL (no
deploy/audit log table was available to check), but it is not explainable as normal
sequencing of the current reindex run (DDL/setup necessarily happens *after* the
operation and subgraph rows are created, not before) — so it's evidence of **some**
prior or overlapping process, not an artifact of my query.

---

## Step 3 — the reindex boundary, and the burst window, per case

### sBTC / `state-v1` (highest priority)

Split at the reindex boundary (block 8,405,235):

```
era           credits          debits           events   net
reindex       28,583,337,595   19,357,726,263   5,494    +9,225,611,332
live (post)      107,489        8,984,418,577      62    -8,984,311,088
-----------------------------------------------------------------------
total         28,583,445,084   28,342,144,840   5,556      +241,300,244   (matches Part B)
```

Further split of the live era by the burst window found in Step 2c:

```
sub-era                         credits   debits         events  min_block  max_block
post-reindex, pre-burst            27,839     22,076,929     55   8,433,413  8,445,098
burst window (07-09→07-21)              0     85,000,000      3   8,511,852  8,514,274
post-burst                         79,650  8,877,341,648      4   8,607,317  8,677,431
```

**Neither the reindex era alone, nor the live era alone, nor the burst window's own
contribution for this holder explains the stored value.** The burst window's own net
for this key is a modest −85,000,000 (0.85 sBTC) — even multiplied by the ~44–94×
system-wide replay factor observed in Step 2, that tops out around −3.7 to −8
billion, an order of magnitude short of the −51.9 billion gap
(`stored − chain_net = −51,644,468,079 − 241,300,244 = −51,885,768,323`). I checked
for a clean integer-multiple relationship (`stored ≈ chain_net − k × debits` or
similar, per the plan's suggested test) across credits, debits, and both era
splits — **no small integer k produces a match.** Reported honestly, per the plan's
instruction: **there is no clean multiple.**

### stakemouse / `amm-vault-v2-01`

```
era                          credits                    debits                     events   net
reindex                      649,388,802,370,935,260    570,226,842,280,496,158    2,617    +79,161,960,090,439,102
post-reindex, pre-burst        2,830,094,896,742,891      1,820,707,003,264,398       19     +1,009,387,893,478,493
burst window                   2,451,314,062,592,335      2,205,234,531,964,743       23       +246,079,530,627,592
post-burst                    50,795,609,488,675,631     11,443,239,465,460,990       16    +39,352,370,023,214,641
total                                                                                        +119,769,797,537,759,828  (matches Part B)
```

Same shape: the burst window's own contribution for this holder (+246 trillion) is
tiny relative to the ~239 quadrillion diff that needs explaining, and no era or
combination of eras — nor a small integer multiple of any of them — reproduces
`stored = -239,053,739,229,588,831`.

### STX / `dlmm-pool-stx-usdcx-v-1-bps-10`

```
era                          credits                debits                 events
reindex                      1,760,912,999,252,961  1,754,130,000,476,415  2,770,442
post-reindex, pre-burst        760,827,018,176,318    761,056,513,520,706    816,703
burst window                   915,757,484,130,808    915,974,163,437,288    944,456
post-burst                      18,247,519,126,395     18,746,898,692,412     21,628
```

Totals match Part B exactly (credits 3,455,745,020,686,482 / debits
3,449,907,576,126,821). Burst-window net for this holder is a near-wash (−216,679,306,480),
nowhere close to explaining `stored = -639,504,311,424,999`.

**Conclusion for Step 3, stated plainly: the burst-window replay found in Step 2 is
real, measured, and localized — but it is too small, for all three cases tested, to
arithmetically account for the magnitude of the stored values.** Replaying each
holder's *own* observed events during the burst window, even at the full ~44–94×
system-wide rate, falls short by roughly one to two orders of magnitude in every
case. Either the replay mechanism is not "this holder's own blocks got re-walked
extra times with correct-but-repeated deltas" (e.g. it could involve deltas
migrating to the wrong key, though I found no structural mechanism for that in
`context.ts`'s increment-batching code — each op is keyed by exact match on
`escapeLiteral`d key column values, with no cross-key blending I could find), or the
true cause predates or lies outside the window this stats table can see, or it is a
different mechanism entirely. I could not resolve which.

---

## Step 3 addendum — testing a per-holder replay factor (coordinator-requested revision)

After the first pass above, the coordinator independently reproduced Steps 2–3's
measurements (confirmed correct) but flagged that my Step 3 rejection of H1 used the
wrong test: I compared each holder's *own* burst-window contribution against the
*fleet-average* ~44–94× multiplier, which conflates a system-wide average over all
blocks with the specific, possibly very different, number of times any one holder's
own few blocks were re-walked. The coordinator proposed solving directly for the
implied per-holder replay factor:

```
k = (stored − reindex_net) / live_net        i.e. stored = reindex_net + k × live_net
```

on the premise that the reindex era is clean (Step 2b: ~95% coverage, no replay) and
all excess lives in a `k`-fold replay of the live era. For sBTC/`state-v1` alone,
this gives `k = 6.775` and reproduces `stored` to within rounding — a plausible
replay count, and the coordinator asked whether this holds up across all 88 rows.

**It does not hold up.** I computed `k` for all 86 failing negative rows and both
failing positive rows (68 of the 86 negatives have `live_net ≠ 0` and thus a defined
`k`; the other 18 have `live_net = 0`, meaning the model predicts `stored =
reindex_net` for them regardless of `k` — and since these rows are in the failing
set by definition, `stored ≠ reindex_net`, so **the model cannot explain these 18
rows at all**, independent of what `k` is elsewhere).

Distribution of `k` over the 68 defined cases:

```
k < 0 (negative — not a meaningful replay count):        28 of 68  (41%)
0 ≤ k ≤ 100 (the coordinator's proposed plausible band):  21 of 68  (31%)
k > 100:                                                   19 of 68  (28%)

min k = -3,298,409         max k = 32,666,668
```

Spread sample across the sorted range (holder truncated):

```
k=-3,298,409   cf-vault-v1-tij04d-so8              live_events=2
k=  -8,755.09  market-factory-v20-bias             live_events=932
k=  -2,152.12  stableswap-pool-aeusdc-usdcx-v-1-1  live_events=520
k=     -36.63  pepe-faktory-pool-v2-2               live_events=185
k=       6.775 state-v1 (sBTC — the coordinator's case)  live_events=62
k=     178.07  univ2-pool-v1_0_0-0065 (STX)          live_events=26
k=   6,888.66  bitcoin-block-finality               live_events=7
k=   7,513.43  dlmm-pool-aeusdc-usdcx-v-1-bps-1      live_events=4010
k=  32,666,668 sendor-stxcity-dex (STX)              live_events=12
```

The two failing **positive** rows give `k = -0.498` (escrow-mainnet-v3) and
`k = 0.556` (univ2-fees-v1_0_0-0056) — both **less than 1**, which under this model
would mean the live era was applied *less than once*, not replayed at all. Neither
falls anywhere near the negative-side band either.

**Correlation with burst-window exposure** (item 3 of the revision request): for the
68 defined-`k` negative rows, Pearson correlation between `k` and each holder's
burst-window share of its live-era event count (`burst_events / live_events`) is
**r = 0.47** — but Spearman rank correlation, which is far less sensitive to the one
or two extreme outliers (the 32.6-million and -3.3-million values dominate the
Pearson number), is **ρ = 0.15** — a weak relationship, not the strong monotonic tie
you'd expect if "more of a holder's activity fell in the measured burst window" were
driving "how far its stored value has drifted." sBTC/`state-v1` itself is a
counter-example to its own fit being burst-driven: only 4.8% of its live-era events
fall inside the burst window, yet it's the case with the cleanest-looking `k`.

**Conclusion on this test: the per-holder replay factor does not cluster in a
plausible band, is frequently negative (impossible for a replay count), spans eight
orders of magnitude, and does not correlate strongly with measured burst-window
exposure.** The sBTC fit is very close, but on this evidence I read it as very
likely a coincidence of one case out of 88, not a demonstration of the underlying
mechanism — the same arithmetic form (one free parameter fit to one data point)
will produce *some* value of `k` for every row by construction; the question was
always whether those values cluster meaningfully, and they don't. Per the
coordinator's own instruction: reporting this plainly rather than forcing the
conclusion. **The current verdict (H1 confirmed as a real, active defect in the live
path; not confirmed as sufficient to explain the sampled magnitudes) stands.**

The sign-flip insight is independent of whether `k` clusters and remains valid: the
reindex era is positive for all three of Part B's cases, the live era swings sharply
negative for sBTC specifically (reindex +9,225,611,332 / live −8,984,311,088 — a
real, measured feature of the chain-plane data, not a replay artifact), and that
alone is why the total can look small and positive while a large negative
`ctx.increment` sequence starting from that base plausibly overshoots past zero.
What this addendum shows is that overshoot's *exact size*, tested rigorously across
the full failing set rather than one case, isn't standing up as a clean function of
the measured replay volume.

---

## Step 4 — hypotheses

**H1 — Replay / double application.**
**CONFIRMED as a real, measured phenomenon; NOT CONFIRMED as sufficient to explain
the sampled magnitudes.** (This verdict was challenged and re-tested — see the
"Step 3 addendum" above, which solves for an implied per-holder replay factor `k`
across all 88 keys rather than one case, and finds it does not cluster in a
plausible range. The verdict here is unchanged after that test.)
`blocks_processed` in the live/catch-up era exceeds the
actual block range by ~44× overall, concentrated in a 12-day burst
(2026-07-09→07-20) that is nowhere near the reindex. This is hard evidence that the
catch-up path re-attempted large ranges of already-processed blocks. Code review
confirms *why* this is dangerous specifically for `ctx.increment`: the catch-up path
(`catchup.ts`) never passes `atomicProgress`, so the managed-write-path replay guard
in `block-processor.ts:566-590` (`statusMode`/`opCursorMode`, which checks
`last_processed_block`/`cursor_block` before running handlers) is **entirely
inactive on the live path** — confirming the plan's flagged-but-unconfirmed fact.
`catchup-leader.ts`'s own doc comment states multiple concurrent catch-up processors
are safe because of "idempotent upserts" — true for plain upserts, **false for
`ctx.increment`**, which is additive and replay-sensitive by the plan's own
established facts. If the catch-up leader lock ever briefly double-held (lease
flap, restart race — I found no direct log evidence either way, only the
`blocks_processed` symptom), the write path has no independent defense; nothing
else stops a second concurrent walk from re-applying deltas. This is architecturally
sufficient to produce corruption, and something clearly caused abnormal
reprocessing in that exact window — but the reconciliation in Step 3 shows the
*specific* magnitudes sampled aren't explained by a simple "this holder's burst-era
events got replayed N times" model. Verdict: **confirmed as an active defect in the
live write path; not proven as the specific cause of the sampled rows' magnitude.**

**H2 — Reorg revert restored a bad pre-image.**
**Cannot determine; partially informative.** `chain_reorgs` shows 12 reorgs between
2026-06-26 and 2026-08-01, roughly one every 3 days — far too few, and each touching
only a single fork-point block via one `processBlock` call
(`reorg.ts:240`), to produce millions of extra block-processings by itself. This
**rules out reorgs as the direct cause of the Step 2 volume anomaly.** However, the
`_journal` table is pruned to 300 blocks (`JOURNAL_RETENTION_BLOCKS`,
`context.ts:12`), so none of the reorgs in this window are still journaled, and I
cannot confirm or rule out a *specific* reorg having restored a stale pre-image for
any of the sampled rows. The `escrow-mainnet-v3` observation in Step 1b (stored
value matches one specific historical delta exactly, with real activity afterward
unaccounted for) is *consistent* with this hypothesis but not proof of it.

**H3 — `decoded_events` rewritten after the subgraph consumed it.**
**Cannot determine, but no positive evidence found.** `decoder_checkpoints` shows
`decode.ft_transfer.v1`, `decode.stx_transfer.v1`, `decode.ft_mint.v1`,
`decode.ft_burn.v1`, `decode.stx_mint.v1`, `decode.stx_burn.v1` all currently
checkpointed at `8691081:2147483647`, continuously updated through "now"
(2026-08-02 19:09) — normal steady-state, no sign of having been reset to a lower
height. Three `backfill.*` checkpoints exist (`backfill.sbtc_token`, `backfill.sbtc`,
`backfill.stx_transfer`) dated **2026-06-21/22 — before** the asset-holdings reindex
(06-26) — so those backfills predate and could not have invalidated data the
subgraph had already consumed. This table only exposes current checkpoint state, not
history, so a decoder reset *between* two points I can observe is not something I
can rule out from this table alone. No direct evidence found either way.

**H4 — Handler/version change mid-flight.**
**Largely ruled out; one unresolved data point.** `subgraphs.version = '1.0.0'` —
only one version is on record, `created_at` and `updated_at` show one continuous
deployment (`created_at = 2026-06-26 15:52:30`, matching the sole `reindex`
operation to the millisecond), and there is no schema-history table to check for a
silent rebuild. This is consistent with "only one deploy ever happened" and argues
against a stale-handler-survived-a-later-deploy story. The one loose thread: the
Step 2c finding that `is_catchup=false` stats begin 20 minutes before this
subgraph's own `created_at`/operation timestamp. If `subgraph_processing_stats` is
carrying rows from an **earlier, now-superseded deploy generation** of a subgraph
also named "asset-holdings" (the table has no generation/id column to separate
them), that would mean a **prior incarnation's reindex/catch-up was still writing
when the current deploy's `DROP SCHEMA CASCADE` (`reindex.ts:550`) ran** —
a genuine schema-drop race window. I could not confirm or refute this without
deploy/audit history outside what's queryable; flagging it as the most concrete
unresolved lead for H4/H5.

**H5 — something else.**
The most defensible summary of the evidence: this looks like **more than one
mechanism**, not one clean story. (a) A confirmed, measured, architecturally-real
replay defect in the live path, localized to 2026-07-09→07-20, that the code makes
plausible via the missing `atomicProgress` guard on catch-up plus the (apparently
mistaken) "idempotent upserts" assumption in `catchup-leader.ts`. (b) An unexplained
20-minute pre-existence of processing stats under this subgraph's name, hinting at a
possible deploy-generation overlap/schema-drop race that predates and is separate
from the 07-09 burst. (c) The magnitude mismatch in Step 3 — none of the three
highest-confidence cases reconcile to a small integer multiple of any era's
observed activity — which means neither (a) nor (b) alone, as currently understood,
is sufficient to explain the specific stored numbers. I did not find a sixth
mechanism to propose; I looked at the increment-batching code
(`context.ts:756-999`) for cross-key contamination and found none — every op is
keyed by exact literal match on the target row's key columns, with a `Map` keyed by
the same signature, so I don't have a code-level mechanism for one holder's delta
landing on another holder's row.

---

## ROOT-CAUSE STATEMENT

**Not fully determined.** What is established with direct evidence:

1. The write path (`ctx.increment`) is arithmetically correct but replay-sensitive
   (established fact, reconfirmed by reading `context.ts`'s statement-building code).
2. The catch-up (live) path has **no replay guard** — confirmed by code, not just
   inferred — while reindex/backfill do.
3. The subgraph's own processing-stats history shows the catch-up path **did**
   over-process by a wide margin (~44× overall, up to ~94× on individual days),
   concentrated in a **specific 12-day window (2026-07-09→07-20)** that has nothing
   to do with the reindex.
4. That over-processing, measured directly against each of the three
   highest-priority holders' own chain-plane activity, is **too small by roughly
   1–2 orders of magnitude** to explain the specific stored values by itself under a
   straightforward "replayed N times" model.
5. 86 of 88 negative rows and 2 of 40 sampled positive rows all show the *same
   qualitative shape* (stored diverges from a small, usually-positive chain-plane
   net by a large factor) — a shared signature across the whole table, not
   independent one-off errors, which argues for a common systemic mechanism even
   though its exact shape is unresolved.
6. A more targeted version of point 4 — solving per-holder for the implied replay
   count `k` in `stored = reindex_net + k × live_net`, rather than applying the
   fleet-average multiplier — was tested at the coordinator's request across all 86
   failing negative rows plus both failing positive rows (Step 3 addendum). It does
   **not** rescue the replay-alone story: `k` is negative for 41% of rows (not a
   valid replay count), spans eight orders of magnitude (−3.3M to +32.7M), only 31%
   land in the proposed plausible 0–100 band, 18 of 86 rows have `live_net = 0` and
   so cannot be explained by the model at any `k`, and `k`'s correlation with a
   holder's own burst-window exposure is weak (Spearman ρ = 0.15). One case (sBTC)
   fits the model almost exactly; the full-sample test indicates that is very likely
   coincidence rather than the general mechanism.

**Narrowest remaining question**: what happened to this subgraph's processing
pipeline between **2026-06-26 15:32 and 15:52** (the 20-minute pre-existence of
`is_catchup=false` stats before this deploy's own timestamps) and, separately, what
specifically triggered the **2026-07-09→07-20 catch-up burst** — was it a leader-lock
overlap (multiple processes believing they held the catch-up lock), a restart loop,
or something else? Neither is answerable from read-only SQL against the tables
available; both would need process/deploy logs (not present in either Postgres
instance queried here) or, going forward, instrumentation that records per-block
processing attempts with a process/worker identifier, not just per-minute
aggregate buckets. Until that's available, I can say with confidence that **the
stored `holdings.amount` values cannot be trusted**, and that **the live/catch-up
write path has a confirmed, real correctness gap** (missing replay guard) that is
sufficient in principle to produce exactly this class of corruption — but I cannot
certify that gap, on its own, as the complete explanation for the specific numbers
in the table today.

No fix is recommended here per the plan's scope. A remediation plan would need to
address, at minimum: (a) adding a replay guard to the catch-up path equivalent to
what reindex/backfill already have, (b) correcting the `catchup-leader.ts` doc
comment's idempotency assumption so it isn't relied on again for another
`ctx.increment`-based subgraph, and (c) deciding whether the existing 28,028 rows
need re-derivation from scratch (a reindex) rather than a targeted patch, given the
scope finding in Step 1b.

---

## Blast radius

`ctx.increment` is shared by every accumulator subgraph on the platform. Of the five
deployed subgraphs (asset-holdings, bns-names, contract-deployments, pox-stacking,
sbtc-flows), this investigation only instrumented **asset-holdings**. I did not
query `subgraph_processing_stats` for the other four, so I **cannot rule any of them
in or out** — but the mechanism identified (H1: catch-up path has no replay guard,
architecturally) is not asset-holdings-specific; it lives in shared runtime code
(`catchup.ts`, `block-processor.ts`) that every managed subgraph's live path runs
through. **Any of the other four subgraphs that use `ctx.increment` for an
accumulator table is exposed to the same class of defect if it experienced a similar
catch-up over-processing episode.** Whether any of them actually did is unmeasured —
that would be the natural first follow-up (repeat Step 2's `subgraph_processing_stats`
query for each of the other four subgraph names; it's cheap and was the single
highest-signal query in this whole investigation).

---

## Query inventory (for reproducibility)

All chain-plane queries ran with `SET statement_timeout='600s'` and completed (none
timed out or were cancelled in this investigation — a difference from Part B, where
one raw-`events` STX scan did time out; this investigation avoided that class of
query by always filtering on the indexed `sender`/`recipient` columns rather than
scanning `events.data->>'...'`). Control-plane queries against
`subgraph_operations`, `subgraph_processing_stats`, and `subgraphs` on
`secondlayer_platform` all completed in well under a second.

---

## Verification pass — 2026-08-02, adversarial re-check (fresh context)

> Independent re-verification by a fresh agent with no stake in the conclusions
> above. All queries re-run from scratch (`SELECT`-only, both planes); all
> file:line cites re-derived from source, not copied from this doc. Two
> mislabeled holder names in the Step 3 addendum's spread table were corrected in
> place as part of this pass (`univ2-pool-v1_0_0-0065`, not `-0061`, carries
> k=178.07/26 events — the actual `-0061` row is k=−1.32 over 5 events; and
> `stableswap-pool-aeusdc-usdcx-v-1-1`, not `stableswap-staking-stx-ststx-v-1-4`,
> carries k=−2,152.12/520 events — the actual staking row is k=18.13 over 48
> events). The underlying aggregates were computed from the correct rows and
> reproduce exactly; only the labels were wrong.

### Per-claim verdicts

| Claim | Verdict |
|---|---|
| 1 — 20.68M blocks_processed, ~44× live-era, 07-09→07-20 burst | **CONFIRMED — and strengthened** (counted = committed on the live path) |
| 2 — sBTC `state-v1` era-split numbers | **CONFIRMED** (every number exact, including sub-era splits event-by-event) |
| 3 — k-distribution refutes replay | **PARTIALLY CONFIRMED** (arithmetic exact; the anti-replay inference is overreach — see below) |
| 4 — 38/40 positives reconcile → defect selective | **Measurement confirmed; conclusion REFUTED** (sampling artifact) |
| 5 — catch-up lacks the replay guard | **CONFIRMED** (no equivalent guard under any name; concrete dual-writer sequence constructible) |

### Claim 1 strengthened: a counted processing IS a committed write on the live path

Section 2a above hedged that high `blocks_processed` "could be many safe
re-attempts that were skipped." That hedge is wrong for the live path — in this
doc's favor. Traced: `result.timing` is assigned only at
`block-processor.ts:668-673`, after the transaction branch completes. Early
returns at `block-processor.ts:361-363` (block missing) and `403-411` (matched=0)
never set timing and are never counted; a thrown transaction (including every
failed `processBlockWithRetry` attempt, `block-processor.ts:303-320`) is never
counted. The skip-still-counted path (`block-processor.ts:566-590` skip → falls
through to timing) requires `atomicProgress`, which catch-up never passes
(`catchup.ts:309-311` passes only `{ preloaded }`). Therefore every one of the
12.68M live-era counts corresponds to a **committed managed transaction** in
which handlers ran and any `ctx.increment` ops flushed. Era split and daily burst
breakdown reproduced row-for-row (reindex era 8,004,491 exactly; live era
12,676,598 at re-check time, delta vs 12,676,555 is same-day accrual; burst
window holds 12,515,855 = 98.7% of live-era volume).

### Claim 3 corrected in both directions

The Step 3 addendum's kill of the **uniform per-holder** replay model stands.
But this doc's own "replay too small by 1–2 orders of magnitude" test (Step 3)
was also ill-posed: it multiplied each holder's burst deltas by the
**fleet-average** 44–94× multiplier. Per-height replay counts under cursor-thrash
are heterogeneous — heights just above a stuck cursor get re-walked on every
tick for days. sBTC's gap ÷ its burst deltas ≈ **610×**, achievable by a
walk-per-tick loop over ~11 days. Negative k and live_net=0 rows do **not**
refute replay: with mixed-sign deltas at different heights and per-block counts
n_b, the effective k = Σn_bδ_b/Σδ_b can take any value including negative. And k
is ill-conditioned when live_net ≈ 0: cf-vault's live_net is **+3** (credits
9,895,230 vs debits 9,895,227), sendor's is **−3** (500,002,634 vs 500,002,637)
— the million-scale k values are numerical artifacts, evidence of nothing.

### New finding: a LOST-EVENT signature coexists with replay

Three cases where the gap is exact under-application, not replay:

- **cf-vault-v1-tij04d-so8 / zft**: gap = −9,895,227 − (+3) = −9,895,230 =
  exactly its single `ft_mint` credit at block **8,613,401** (amount 9,895,230),
  never applied.
- **sendor-stxcity-dex / STX**: gap = −98,000,000 = exactly one of its **three
  identical 98M credits** (blocks 8,586,131 / 8,586,150 / 8,586,164, inside the
  burst window), never applied.
- **escrow-mainnet-v3 / STX**: stored 325,000,000 equals the exact running
  balance after the event at block **8,621,682**; the last two events
  (−325M @ 8,621,685, +999M @ 8,621,906) were never applied. No reorg in
  `chain_reorgs` has a fork ≤ those heights (nearest is 8,625,260), so this is
  not reorg deletion. This supersedes Step 1b's "stale accumulator matching one
  debit" curiosity — the match to a 325M debit amount was coincidence; the real
  signature is a truncated prefix.

Under-application and over-application coexist on the live path. A
single-parameter replay fit cannot see loss and produces garbage k where loss
dominates — a further reason the k-scatter refutes nothing about replay.

### Claim 4 refuted: "selective" was a sampling artifact

A fresh 10-row random positive sample (different randomization) reconciled
10/10 — but **all 10 had zero live-era events**. Random draws over 28,028 rows
land on dormant holders whose entire history is in the clean reindex era; the
38/40 result measured that base rate, not the defect's scope. A targeted sample
of the top-25 burst-window-active contract holders: **every row with a nonzero
net fails, positives included**, wrong by ×3 to ×714 in both directions —
`dlmm-pool-sbtc-usdcx-v-1-bps-10`/sBTC stored 448,695,188,340 vs chain net
628,149,712 (×714 inflated); `dlmm-pool-ststx-stx-v-1-bps-1` ×333;
`dlmm-pool-stx-sbtc-v-1-bps-15` ×393; `amm-vault-v2-01`/alex ×3.6 **deflated**
(consistent with replayed net-negative live blocks); arkadiko-swap ×3.3. The
clean natural experiment: `dlmm-pool-leo-stx-v-1-bps-50` has **zero reindex-era
events** — its entire history is live-era — and stored = ×16.4 chain net, so its
corruption is 100% live-path. The only burst-active rows that "reconcile" are
flow-through bots (blue, hilt, bill) whose credits and debits are exactly equal
in every era: stored 0 = chain net 0, where replay is arithmetically invisible
by construction. **Corrected blast radius: every holder with unbalanced
live-era (especially burst-window) activity — hundreds to thousands of rows,
not 88.**

### Claim 5: the concrete dual-writer sequence

The leader lock is a session advisory lock (`leader.ts`,
`catchup-leader.ts:44-64`). Losing the lease does **not** cancel an in-flight
walk: leadership is checked only at `runCatchUp` entry (`processor.ts:492-493`);
the walk loop re-checks only `status === 'active'` (`catchup.ts:243-249`). The
lock connection can drop silently on driver auto-reconnect (acknowledged at
`leader.ts:84-99`). The cursor write is unconditional and non-monotonic
(`subgraphs.ts:326-340`, deliberate for reorg rewind). Sequence: leader A
mid-walk loses its lock connection; B acquires within ≤15s and walks from the
committed cursor; A continues to tip regardless; both commit increments for
overlapping heights; every commit by the laggard **regresses**
`last_processed_block`, so each NOTIFY/5s poll (`processor.ts:507-540`) triggers
another full re-walk of laggard-height→tip — per-height application counts grow
without bound while the overlap persists, concentrated just above the laggard's
position. This matches both the burst's shape and the ×hundreds per-height
factors the magnitudes require. The `catchup-leader.ts:12-15` "idempotent
upserts keep it correct" comment is false for `ctx.increment`. Secondary hazard,
same family: `handleSubgraphReorg` runs on **every** process
(`processor.ts:517-535`) and its delete+journal-restore+reprocess
(`reorg.ts:64-129,240`) is not cross-process-serialized. Which sequence fired in
July is not provable from read-only SQL; the missing cross-process defense is
code fact. Supporting circumstantials, both verified: 07-08 has **zero** stats
rows (restart/deploy-churn signature immediately preceding the burst), and the
20-minute pre-op stats anomaly is real and is **not clock skew** — bucket
timestamps are JS-clock (`stats.ts:74,88`) and op `created_at` is a DB default
(`subgraph-operations.ts:58-72`), but the reindex's final bucket_end
(00:55:12.635) matches the op's `finished_at` (00:55:12.641) to 6ms, so the
clocks agreed.

### Cross-subgraph check

No burst-scale over-processing on the other four deployed subgraphs: in the same
window, bns-names processed ~265k blocks (~1× its live range), pox-stacking
~230k (~1×), contract-deployments ~13k, sbtc-flows ~8k. Corruption of this
magnitude is likely asset-holdings-specific in practice (its walks are the
fleet's slowest — it matches nearly every block); the vulnerable code path is
shared by all of them.

### Superseded conclusions

Readers must no longer rely on the following earlier statements in this doc
(left intact above as the record):

1. **"Replay is not sufficient to explain the sampled magnitudes"** — Step 3's
   conclusion, the Step 3 addendum's final framing of H1, and ROOT-CAUSE
   statement items 4 and 6 insofar as they rest on it. Both tests used
   (fleet-average multiplier; uniform per-holder k) were ill-posed. Per-height
   heterogeneous replay plus the lost-event signature is consistent with
   everything measured; no additional exotic mechanism is required by the data.
2. **The "selective / small tail" scope framing** — Step 1b's verdict and
   ROOT-CAUSE framing that the blast radius is "at least the 88 negative rows
   plus an apparently small tail." The defect hits every unbalanced live-active
   holder; the 88 negatives are merely where it crossed zero and became visible.

### Next measurement

Count `holdings` rows whose holder has ≥1 unbalanced live-era event (net ≠ 0
over blocks > 8,405,235) — that single number is the real blast radius and the
input remediation scoping needs. Remediation itself (live-path replay guard +
full reindex) is a separate founder-approved plan; row-patching the 88 negative
rows is provably insufficient — 9/9 burst-active positive rows tested are also
wrong.

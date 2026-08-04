# Asset-holdings: why contract balances go negative

> 2026-08-02. Read-only forensic investigation, Part B of plan `f065`. Prod access was
> `SELECT`-only throughout; nothing was written, redeployed, or reindexed. Companion:
> `subgraphs/asset-holdings.ts` (the deployed subgraph, recovered into git under the same
> plan). This doc does not implement a fix — it exists to inform a founder decision.

## The headline finding

The investigation's leading hypothesis — that negative rows come from tokens whose
contracts don't emit `ft_*` events for credits (non-conforming SIP-010 ledgers) — **does
not hold for any of the three cases tested**, including the two FT cases. For all three
(native STX, a memecoin, and sBTC), the full chain-plane transfer history — reconstructed
independently from both `decoded_events` and the raw `events` table, which agree with
each other exactly — shows the holder receiving **more** value than it sent. The observed
debits do **not** exceed the observed credits. Yet the stored `holdings.amount` is deeply
negative in all three, by 100x–1000x the reconstructed net.

That rules out the leading hypothesis (bucket B3-a) for all three cases, and rules out an
event-plane gap (bucket B3-c — the STOP condition) for the two FT cases, since raw and
decoded events match exactly with zero discrepancy there (the STX case's raw-events
cross-check timed out and is unconfirmed — see Case 1). What's left is a genuine
unknown: the stored accumulator value cannot be reproduced from the chain-plane data
currently available, by any mechanism checked (duplicate rows, non-canonical remnants,
reorg-journal reverts, alternate asset-identifier spellings — all checked, all clean).
See B3 below.

## B1 — shape of the problem

```sql
SELECT kind, count(*) AS neg_rows, min(amount) AS worst
FROM subgraph_005f2b11_asset_holdings.holdings WHERE amount < 0 GROUP BY 1;
```
```
ft  | 60 | -239053739229588831
stx | 28 | -639504311424999
```

Per-asset breakdown (`asset_identifier`, count, worst):

```
STX (native)                                                            | 28 | -639504311424999
sbtc-token::sbtc-token                                                  | 12 | -51644468079
token-aeusdc::aeUSDC                                                    |  8 | -9346896997710
wrapped-stx-token::wstx                                                 |  5 | -2730041969
usda-token::usda                                                        |  4 | -209057141925
miamicoin-token-v2::miamicoin                                           |  3 | -1897434671153474
ststx-token::ststx                                                      |  3 | -6536637657
usdcx::usdcx-token                                                      |  2 | -21169684100076
usdh-token-v1::usdh                                                     |  2 | -10914383805392
tokensoft-token-v4k68639zxz::tokensoft-token                            |  2 | -1310844140716
flat-earth-stxcity::FlatEarth                                           |  2 | -16518126621645
stableswap-pool-stx-ststx-v-1-4::pool-token                             |  1 | -2097548814025
notastrategy::NASTY                                                     |  1 | -4796610307639501
v0-vault-stx::zft                                                       |  1 | -9895227
nope::NOT                                                                |  1 | -1174053257735
age000-governance-token::alex                                           |  1 | -30957778
satoshai::satoshai                                                      |  1 | -198239902952322
welshcorgicoin-token::welshcorgicoin                                    |  1 | -134598707900445
pontis-bridge-pBTC::bridge-token                                        |  1 | -560471
b-faktory::B                                                            |  1 | -4295150006777528
```

```sql
SELECT holder FROM subgraph_005f2b11_asset_holdings.holdings
WHERE amount < 0 AND holder NOT LIKE '%.%' LIMIT 5;
```
Zero rows. Confirms the contract-only filter is working exactly as coded — every
negative row is a contract principal, no EOA rows exist in this table at all.

Notably, `sbtc-token` — a signer-governed, standards-compliant, blue-chip asset — is the
**second-worst asset by row count** (12 rows), right behind native STX. This is the
signal that motivated prioritizing Case 3 below: if a blue-chip asset goes negative for
the same reason as a memecoin, the cause is systemic, not a long-tail token-design
problem.

## B2 — three reconstructed cases

For each case the chain-plane reconstruction sums `decoded_events` (`canonical = true`,
filtered on `asset_identifier` and `sender`/`recipient` matching the holder), split into
credits (holder as `recipient`) and debits (holder as `sender`), then cross-checked
against the raw `events` table (`data->>'sender'`/`'recipient'`/`'amount'`) for the exact
same filter.

### Case 1 — STX, `SM1FKX...dlmm-pool-stx-usdcx-v-1-bps-10`

Stored: `amount = -639504311424999` (≈ ‑639.5M STX — more STX than exists in total
supply, on its face implausible as a real balance).

`decoded_events`, `event_type = 'stx_transfer'` only (no `stx_mint`/`stx_burn` matched):

```
credits = 3,455,745,020,686,482   (n = 2,408,110)
debits  = 3,449,907,576,126,821   (n = 2,145,119)
net     =     5,837,444,559,661   (positive)
```

Raw `events` cross-check (`type = 'stx_transfer_event'`, same filter) was attempted
with a 280s statement timeout and **timed out** (`ERROR: canceling statement due to
statement timeout`) — this is the exact class of query the brief warned would exceed
120s; STX transfer volume system-wide is far larger than any single FT asset. **This
one leg is unconfirmed against raw events; do not assume it would match.** The
`decoded_events` reconstruction and the `_journal` check (below) are solid and did
complete.

- Debits do **not** exceed credits — net is positive ~5.84M STX, not the stored
  −639.5M STX. Gap is enormous and does not correspond to any subset of the observed
  volume.
- `_journal` (reorg-revert log) is **empty** for this holder/kind — but this is
  **not evidence of absence**. `_journal` is pruned to a 300-block window
  (`JOURNAL_RETENTION_BLOCKS = 300`, `packages/subgraphs/src/runtime/context.ts:12`,
  deleted via `packages/subgraphs/src/runtime/block-processor.ts:709`), and the
  subgraph is at block ~8,690,850 — any revert from earlier than ~300 blocks ago has
  long since been deleted regardless of whether it happened. A reorg revert restoring
  a bad pre-image cannot be ruled out for this row.

### Case 2 — FT (memecoin), `amm-vault-v2-01` / `stakemouse`

Stored: `amount = -239053739229588831`.

`decoded_events`, `event_type = 'ft_transfer'` only:

```
credits = 705,465,820,818,946,117   (n = 1,178)
debits  = 585,696,023,281,186,289   (n = 1,497)
net     = 119,769,797,537,759,828   (positive)
```

Raw `events` cross-check (`type = 'ft_transfer_event'`, same filter) — **identical
numbers**: `705465820818946117 | 585696023281186289 | 1178 | 1497`. `decoded_events`
and raw `events` agree exactly; no event-plane discrepancy exists between the two chain
tables.

- Debits do **not** exceed credits — net is positive ~1.2e17, not the stored
  −2.39e17. `_journal` is empty for this key, but (as with Case 1) that's not
  probative — see the pruning note there.

### Case 3 — FT (blue-chip), `state-v1` / `sbtc-token` (highest priority)

Stored: `amount = -51644468079` (≈ ‑516.4 sBTC).

`decoded_events`, `event_type = 'ft_transfer'` only (no `ft_mint`/`ft_burn` matched —
confirmed via `SELECT DISTINCT event_type` on the unsplit query):

```
credits = 28,583,445,084   (n = 2,645)
debits  = 28,342,144,840   (n = 2,911)
net     =    241,300,244   (positive)
```

Raw `events` cross-check (`type = 'ft_transfer_event'`, same filter) — **identical
numbers**: `28583445084 | 28342144840 | 2645 | 2911`. Also verified zero rows have
`canonical = false` for this filter (no orphaned reorg remnants), zero duplicate
`(tx_id, event_index)` pairs, and no alternate `asset_identifier` spelling for sBTC
matched this holder (`ILIKE '%sbtc%'` returns only the one identifier already used).
`_journal` is empty for this key, but (as with Case 1) that's not probative — see the
pruning note there.

- Debits do **not** exceed credits — net is positive ~2.4 sBTC, not the stored
  −516.4 sBTC.
- Could not fetch `sbtc-token`'s source (`/v1/contracts/<id>` returned only ABI
  metadata, no `source_code` field; the node's `/v2/contracts/source/...` endpoint
  404'd from this environment) — so the "does it use `define-fungible-token`" check
  from the B3-a playbook is **not directly confirmed**. It doesn't matter for the
  verdict: sBTC produced 5,556 well-formed `ft_transfer` events with clean
  sender/recipient/amount fields across its full recorded history for this holder,
  which is itself evidence against a non-emitting ledger, independent of source
  inspection.

## B3 — mechanism classification

| Case | Bucket | Why |
|---|---|---|
| 1 (STX) | **B3-d** | B3-a is inapplicable by definition (native STX is not a custom token ledger). Debits don't exceed credits in the reconstructed history. Raw-events cross-check **timed out** (280s, confirms the brief's performance warning) so B3-c cannot be formally ruled out for this case the way it was for 2 and 3. `_journal` is empty but not probative (300-block prune window). No positive evidence of a decode gap, but none can be ruled out either. |
| 2 (stakemouse) | **B3-d** | Raw events = decoded events exactly (B3-c formally ruled out). Debits don't exceed credits — the leading B3-a hypothesis is contradicted by the data itself. `_journal` empty but not probative. |
| 3 (sbtc-token) | **B3-d** | Same as case 2: raw = decoded exactly (B3-c ruled out), debits don't exceed credits, no duplicate or aliased rows, `_journal` empty but not probative (300-block prune window — does not rule out a historical reorg revert). sBTC is (functionally, from its event shape) a conforming token, so B3-a doesn't fit even loosely. |

**None of the three cases land in B3-a, B3-b, or B3-c as defined.** B3-c specifically —
"a credit present in raw `events` but missing from `decoded_events`" — is the STOP
condition, and it did **not** occur: for cases 2 and 3, `decoded_events` and raw
`events` produced byte-identical sums and counts. There is no indexer decode-layer gap
between these two chain-plane tables for the transactions checked, so no STOP.

**Overall call: bucket B3-d.** All three cases — spanning native STX, a memecoin, and a
blue-chip signer-governed token — show the same shape: the currently-available
chain-plane history nets modestly *positive* for the holder, while the stored
`holdings.amount` is deeply *negative*, by two to three orders of magnitude. Every
mechanism checked that could explain a stored value diverging from current chain-plane
content came back clean:

- No duplicate `decoded_events` rows (`count(*) = count(DISTINCT cursor) = count(DISTINCT (tx_id, event_index))` for case 3).
- No non-canonical remnants (100% of matched rows are `canonical = true`).
- The `_journal` is empty for all three keys, but this is not probative — it is
  pruned to a 300-block window (`JOURNAL_RETENTION_BLOCKS = 300`,
  `packages/subgraphs/src/runtime/context.ts:12`, pruned in
  `packages/subgraphs/src/runtime/block-processor.ts:709`), so any historical revert
  evidence is long gone at block ~8,690,850. A reorg revert that restored a bad
  pre-image remains a live, unruled-out hypothesis.
- No alternate/aliased `asset_identifier` string capturing missed volume.
- `decoded_events` and raw `events` agree exactly (cases 2 and 3; case 1 unconfirmed).

Given all of that is clean, the divergence must originate somewhere between "the event
stream as the subgraph originally consumed it" and "the event stream as it reads today"
— or in the accumulator's write path itself — neither of which is inspectable from
read-only chain-plane or control-plane SQL. Plausible mechanisms this investigation
cannot confirm or rule out without runtime/deploy history access: a decoder revision
that reprocessed and changed `decoded_events` content sometime after `asset-holdings`
had already consumed the earlier values; an unlogged double-application during a
backfill/redeploy (the `_journal` table only records reorg reverts, not
backfill-replay events, so it would not show this even if it happened); or a reorg
revert that restored an incorrect pre-image, which `_journal`'s 300-block retention
window cannot confirm or rule out this far after the fact. **This is a
different and more serious problem than the leading hypothesis.** "Some long-tail
tokens don't emit credit events" is a bounded, explainable limitation. "The stored
accumulator can't be reproduced from current chain-plane data, for a blue-chip token,
by three orders of magnitude" is a trust problem in the accumulator itself, and — if it
generalizes across the other 85 rows — potentially in `ctx.increment`'s replay/backfill
path more broadly, not just this one subgraph's token-design assumptions.

## Header comment correctness

The deployed subgraph's header comment claims:

> *"Contracts have no genesis/coinbase allocation: every contract holding comes from
> tracked transfers and nets correctly (≥ 0)."*

This is empirically false — all 88 negative rows are contract principals (§B1) — and
should be corrected regardless of which remediation below is chosen. Whoever edits it
should preserve the surrounding rationale for `int` vs `uint` (a `uint` CHECK constraint
crashed a production block at height 286; do not reintroduce it) — only the false
final sentence needs to change.

## Recommendation

Given the B3-d finding, **read-side guard (option 1)** is the right immediate step, not
chain-read reconciliation (option 2). Option 2's premise is that seeding the true
on-chain balance corrects a *known, bounded* omission (a token that doesn't emit credit
events). That premise doesn't hold here — the divergence isn't explained by a missing
credit, and if it traces back to a systemic replay/backfill defect in `ctx.increment` or
the block-source layer, silently reseeding "correct" values via `readContractAt` would
mask the symptom in this one table without addressing whatever produced it, and the same
defect could recur on the next backfill or resurface in other subgraphs that use the same
accumulator path. Node-call volume for option 2 was not estimated for this reason — it's
premature until the mechanism is understood.

**Recommend:** (1) exclude or clamp negative rows in `find_value_contracts` now — cheap,
reversible, stops a broken row from hiding an audit target; (2) correct the header
comment's false claim as part of that same change; (3) treat root-causing the
chain-plane/accumulator divergence found here as a separate, higher-priority follow-up
investigation — with access to deploy/backfill history for this subgraph deployment —
before considering option 2 anywhere in the system. The founder decides the sequencing
and whether the follow-up investigation is worth resourcing ahead of other work.

Note for whoever picks up (1): `find_value_contracts` is **not defined anywhere in
this repo** — a repo-wide search matches only this doc and the reference to it in
`subgraphs/asset-holdings.ts`'s header comment. It appears to live in a separate
consumer (audit-sentinel); look there, not here.

---

## Addendum — 2026-08-04, post-replay-guard reindex-path investigation

> Read-only forensic follow-up. The live-path replay guard (f069, see
> `live-path-replay-guard.test.ts` and `catchup.ts`'s per-iteration leadership
> check) has since shipped, and a clean ~6h47m from-genesis reindex completed
> 2026-08-03 03:07→09:54 UTC (`subgraph_operations` id `fae75ad1`). This
> addendum re-scopes to whether the REINDEX path itself (as opposed to the
> since-fixed catch-up replay defect) under-applies events, using
> cursor-bounded per-row reconciliation instead of the superseded fleet-average
> / per-holder-`k` methods above. Prod access was `SELECT`-only plus read-only
> HTTPS GETs against the public Index API throughout; nothing was written,
> redeployed, or reindexed against prod. Local docker Postgres was used for the
> one write-capable reproduction attempt (Step 3).

### Correction: negative-row count oscillation is normal, not a signal

The row count at `amount < 0` moved 50→51→52→51 across this investigation as
live rows crossed zero in both directions. **This is expected** — the table
keeps updating live. The only valid reconciliation method is **cursor-bounded**:
snapshot the subgraph's `last_processed_block`, then bound every chain-plane
query to `block_height <= that height`. Unbounded or differently-timed
snapshots are not comparable to each other and produce apparent "drift" that
is really just measurement skew. All numbers below are bounded to cursor
`8,699,193` (captured once, then reused for every query in this pass).

### Step 1 — cursor-bounded reconciliation, full negative set + positive sample

All 52 negative rows present at the time of the snapshot (49 `ft`, 3 `stx`)
were reconciled against `decoded_events` (`canonical = true`, event types
matching the deployed handler: `ft_transfer`/`ft_mint`/`ft_burn` or
`stx_transfer`/`stx_mint`/`stx_burn`), credits split by `recipient`, debits by
`sender`, both bounded to `block_height <= 8699193`.

**Result: 2 of 52 reconcile exactly (both `stx`) — the same two rows Part B
found genuinely, correctly negative** (`univ2-pool-v1_0_0-0173`: stored
`-29,952,162` = chain net exactly; `hilt`: stored `-22,178,700` = chain net
exactly). **The other 50 (49 `ft` + 1 new `stx` row, `vgld-vault-v4`,
deficit −17,790,183) do not reconcile** — every one is missing chain-plane
volume the accumulator should have applied (`stored < chain_net` in every
failing case; never the reverse in this set). This generalizes the two
priority cases from the plan (`gl-fees-bank`/sbtc-token, deficit −3,699 on a
net of 0; `alex-vault-v1-1`/mega, deficit −6,425 on a net of +201) to the
full 50-row set.

A **35-row random positive sample** (9 `stx`, 26 `ft`) reconciled the same
way: **34 of 35 exact, 1 of 35 fails** —
`univ2-farming-distributor-1-v1_0_0-0009` / `wen-nakamoto-stxcity::WEN`,
stored `7,319,861,717,284` vs chain net `7,308,750,932,822`, deficit
`11,110,784,462` (same under-application shape as the negatives, ~0.15% of
gross volume — much smaller in relative terms than the worst negatives).

**Blast-radius verdict**: ~96% of currently-negative rows are wrong, ~3% of a
random positive sample is wrong. This is a **materially smaller blast radius**
than f068's "every unbalanced live-active holder, hundreds to thousands of
rows" finding — because that finding was about the pre-f069 catch-up replay
defect, which is now fixed. What remains post-fix is a real but much
smaller-magnitude under-application, concentrated in (but not limited to) the
negative rows.

**Deficit-bearing block ranges** (from `GREATEST(max sender block, max
recipient block)` per failing key, bounded to cursor): one genuinely dense
cluster — 17 of the 49 failing `ft` rows are all `SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault*`
relationships with last activity between blocks **148,315 and 154,976**
(and, per the full per-holder event-height list pulled for `mega`, real
activity densely populating **133,776–150,373**) — plus the two priority-case
clusters at block **8,465,501** (`gl-fees-bank` / sbtc-token *and* usdh-token,
same block) and a long tail of isolated single-holder deficits scattered
across the whole chain (296k, 398k–433k, 510k, 599k, 644k, 1.18M, 1.6M–1.61M,
2.13M, 2.88M, 8.24M, 8.30M, 8.39M, 8.66M–8.67M). The scattered tail does not
cluster into a small number of incident windows the way the f068 catch-up
burst did — it looks like a low, steady background rate rather than one
episode.

### Step 2 — SDK-consumer comparison: clean

A minimal consumer built ONLY on `@secondlayer/sdk` (`Index.events.walk`,
hitting the public `https://api.secondlayer.tools` Index API — no
`packages/subgraphs` runtime code in the path) reconstructed both priority
cases' full credit/debit histories:

```
mega / alex-vault-v1-1:      credits=40,507,496  debits=40,507,295  net=+201
gl-fees-bank / sbtc-token:    credits=1,754,308   debits=1,754,308  net=0
```

Both figures are **byte-identical** to the `decoded_events` SQL reconciliation
above, and to Part B's original numbers. **Verdict: the SDK read path is
correct; `holdings` (the subgraph accumulator) is what's wrong.** This is a
clean, unambiguous pass — no STOP condition. The defect, whatever it is,
is confined to the subgraph-runtime write path; SDK-based consumers reading
the same Index API are unaffected.

### Step 3 — reindex-path reproduction: discard counter never fired

`PublicApiBlockSource.loadBlockRange` (`block-source.ts:226-274`) was
instrumented (locally, uncommitted, reverted after this pass) to count events
whose `block_height` was absent from the blocks-walk-seeded map — the exact
mechanism the leading hypothesis named. Reproduction ran against prod's real
public Index API (read-only GETs; no prod writes) with local docker Postgres
as the write target:

1. A real `reindexSubgraph` call (not a synthetic per-block harness) over
   blocks 140,000–142,999 — the real function, real HTTP walks, real local
   DB writes, `SUBGRAPH_SOURCE=streams-index` — processed ~2,000 contiguous
   blocks with **zero discards**.
2. A targeted sample of 40 exact block heights spanning the *entire*
   `mega`/`alex-vault-v1-1` relationship's history (133,776→150,373) and 59
   exact heights spanning the entire `gl-fees-bank` sbtc-token+usdh-token
   relationship's history (857,750→8,465,501) were each probed via
   `loadBlockRange(h, h)` — **zero discards** across all 99 heights.

**The discard counter never fired.** Per the plan's STOP condition, this
hypothesis is **not supported by empirical evidence** — at least not under
current chain/API conditions, replaying via a fresh, low-concurrency local
process. This does not rule out a historical, timing/concurrency-dependent
occurrence during the original production reindex (a reorg landing between
the concurrent blocks/events walks, the leading candidate) that isn't
reproducible from a quiet replay after the fact — but no positive evidence
for it was found either.

**Pivot per the plan: `FallbackBlockSource` log check.** Read-only
`docker logs secondlayer-subgraph-processor-1` was checked for "fallback" /
"using DB tap" warnings during the reindex window (2026-08-03 03:07–09:54
UTC). **Inconclusive, not clean**: the container was restarted 2026-08-04
02:40:39 UTC (log history starts there), so no logs from the reindex window
exist to check. This is unmeasured, not ruled out.

### Step 4/5 — no fix

Per the STOP condition (discard counter never fired), **no fix was
implemented**. The instrumented `block-source.ts` was reverted to its
committed state; no other file in `packages/subgraphs` was changed. No
regression test was added, since there is no confirmed mechanism to encode
one against.

### Where this leaves things

- The pre-f069 catch-up replay defect is fixed and its blast radius (hundreds
  to thousands of rows) no longer applies.
- A smaller, real under-application defect remains: ~96% of currently-negative
  rows and ~3% of a random positive sample. Its mechanism is **not** the
  `loadBlockRange` blocks/events walk-disagreement hypothesis — that was
  tested directly and did not reproduce.
- Two structural facts from the earlier (superseded) investigation still
  stand and are worth re-reading before the next attempt: (a) the reindex
  era's own `blocks_processed` coverage was 95.2% of its range — consistent
  with sparse early-chain history, not evidence of loss on its own; (b) the
  per-height retry-or-halt logic in both `reindex.ts:289-308` and
  `catchup.ts:302-320` means a height *entirely* missing from the blocks walk
  either self-heals (single-height refetch succeeds) or fails loudly
  (`subgraph_gaps` row or a halted reindex) — neither of which matches the
  silent, gap-free deficits found here. That structural argument, plus this
  addendum's empirical null result, together make the `loadBlockRange`
  map-seeding gap an unlikely explanation going forward, not just an
  unreproduced one this session.
- Genuine next steps, not attempted here: instrument the reindex *write* path
  (`ctx.increment` / `context.ts`'s batching) rather than the read path, since
  Step 2 already clears the read path all the way to the Index API; and
  retry the `FallbackBlockSource` log check with longer-retention logging
  (or a metrics counter) in place before the next full reindex, since this
  pass found the question unanswerable after the fact.

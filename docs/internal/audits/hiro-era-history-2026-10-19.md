# Hiro-era history: known field errors below ~8.2M

Found 2026-10-19 by replaying Hiro's event-replay TSV (raw node payloads) for
heights 50,000–99,999 and running `secondlayer verify` against the signed
archive. Prod history below ~8.2M was loaded from a Hiro API Postgres through
`hiro-pg-client.ts`, so it is a reshaped copy, not node-shaped. The archive is
exported from prod and inherits every row below.

## What is wrong

| Field | Heights | Rows | Cause |
|---|---|---|---|
| `transactions.status`: `abort_by_response` stored as `abort_by_post_condition` | 0 – 7,429,618 | ~1.39–1.5M of 1,597,432 candidates | `mapTxStatus` mapped Hiro -1 to post_condition (fixed `d9908350c`) |
| `blocks.burn_block_hash` / `index_block_hash` NULL | below ~8.2M (`index_block_hash` NULL through 8,199,877) | ~8.2M blocks | below 7,440,674: not carried by the Hiro PG load. 7,440,674 and up: columns added later without a backfill (`burn_block_hash` 0068 `8c8b48c6a`, `index_block_hash` 0089 `361a753df`). Backfilled for 7,440,674–8,199,877 from our node on 2026-11-04 (`repair-block-fields.ts`) |
| `blocks.timestamp = 0` | 7,440,674 – 7,842,144 | 401,373 | our parser read only `payload.timestamp`, which the live node never sends (fixed `513642f6c` 05-03, no backfill). Backfilled from our node on 2026-11-04 (`repair-block-fields.ts`) |
| Failed burnchain-op txs missing | e.g. 58997 (2 txs) | small | Hiro API drops failed burnchain ops |
| Event encoding | below ~8.2M | all | Hiro API shape (`smart_contract_event`, hex values, renumbered `event_index`); same values, different representation |

`transactions_archive` (reorged txs) has the same status mislabels.

## Source boundaries (found by marker search, confirmed by digest diffs)

| Heights | Source | State |
|---|---|---|
| 0 – ~7,429,550 | Hiro API Postgres (`hiro-pg-client`) | Hiro shape, status mislabels, NULL hashes |
| ~7,429,551 – 7,440,673 | Hiro REST API (~11k heights) | `{hex,repr}` values, `raw_result` NULL, NULL hashes |
| 7,440,674 – 8,739,025 | live node, no journal | tx/events node-shaped; block fields: `timestamp=0` to 7,842,144, `burn_block_hash` NULL to 7,856,108, `index_block_hash` NULL to 8,199,877 |
| 8,739,026 – tip | live node + `observer_journal` | clean: 2000/2000 digest matches against the journal and the Hiro TSV |

**Hiro-API islands (443 heights)** inside the live era, planted by
`repair-fork-block.ts` sourcing from `HiroClient` (fixed by plan 318):
7,662,338; 7,827,922–7,827,966; 7,827,981–7,828,032; 7,884,701;
7,973,890–7,973,901; 8,136,347–8,136,673; 8,501,111; 8,524,836; 8,567,288;
8,654,079; 8,663,166. All below PoX-5 activation (8,665,568).

Hiro's event-replay TSV lacks ~840k heights in 7.44M–8.52M, so it cannot be the
sole repair source there.

## What is not wrong

- Successful tx status, sender, type, events and transfers in every era.
- No events from rolled-back (`committed:false`) txs are stored anywhere in prod.
- Everything from PoX-5 activation (Stacks 8,665,568) up is node-sourced; from
  8,739,026 up it is digest-verified against raw node payloads.

## Repair

No field-by-field patching (founder, 2026-10-19). The v2 feeder (node-sourced,
genesis re-sync) replaces this history at the source/target cutover
(`runbook/db-source-target-cutover.md`), then the archive is re-exported and
re-signed from it. Before cutover, the feeder rolls the 2026-10-19 parser fixes
(burnchain ops, multisig, fork flip-back) and re-parses its affected rows.

A pattern repair of statuses (`(err …)` result ⇒ abort_by_response) was tested
and rejected: ~5% of node-sourced `(err …)` aborts are real post-condition
aborts. Replay harness: `scripts/ops/hiro-tsv/`.

## v2 cutover results (2026-11-22)

Plan 317 ran against the v2 copy (H0 = 9,538,869) before GO. Prod moved to
the v2 DB at T = 9,547,130 (17:16 UTC). Full log: `plans/031-cutover-log.md`.

| Check | Result |
|---|---|
| 1 integrity (v2, 0..H0) | PASS: 0 missing heights, 0 empty burn/index hash, 0 `timestamp=0`, 0 unknown type/sender, 0 events on non-success txs, 0 noncanonical blocks |
| 2 self-replay (7 windows) | GREEN: 6 windows 0 diverging; w0050k 59 heights differ only in tx digests, all rows changed by the approved 198-row patch below |
| 3 statuses | PASS: 1,198,450 `post_condition` → `abort_by_response` moves, all below 7.43M; the 1.39–1.5M estimate above was a heuristic. Public API agrees 17/17 sampled |
| 3.2 decoded counts per 1M | PASS (explained): 19 diffs, all v2 > prod (+281,406). v2 decoded = v2 raw success-tx events in every type×bucket ≥ 7M; prod raw is short (the gaps above) |
| 4 per-height digests | PASS after one patch, every family explained (below) |
| 5 subgraph runner | PASS: sip10 22,012/22,012 exact; other diffs are known classes; v2-only rows are prod-shape filter misses |

Check 4 families:

- **`tx_core` 0–200k (v2 defect, patched with founder go):** 198 burnchain-op
  `stack-stx` txs had a 4-byte placeholder `raw_tx` on both sides, so v2 had
  NULL `contract_id`/`function_args`. 194 copied from prod; the 4 failed ones
  absent everywhere got `SP000000000000000000002Q6VF78.pox`, args NULL.
- **`event_encoding` 7.44M–8.2M:** prod contract events carry an extra decoded
  `value` key; v2 has `raw_value` only. Otherwise identical; decoders read
  `raw_value` first.
- **`tx_core` above 200k:** 1,272 txs at 370 heights; v2 `raw_tx` hashes to its
  `tx_id` 1,272/1,272, prod has 774 placeholders (REST era + islands).
- **`tx_count` / `event_shape`:** prod missing data; the public API agrees with
  v2 on every sample.

Other parity at GO: `contracts` rows ≤ H0 copied from prod (153,072; 0
orphans); sBTC topic counts ≤ H0 v2 = prod; settlements 3,325 = 3,325; sBTC
supply at 9,547,116 chain = decoded = raw (248,663,193,223).

VM data (`vm_events`, `state_writes`) is continuous genesis → tip since
2026-11-23: H0..9,550,710 copied from the feeder (fork image), then prod's node
moved to the same fork. Per-height digests prod = feeder, 0 diff.

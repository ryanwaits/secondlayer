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
| `blocks.burn_block_hash` / `index_block_hash` NULL | below ~8.2M (`index_block_hash` NULL through 8,199,877) | ~8.2M blocks | not carried by the Hiro PG load |
| `blocks.timestamp = 0` | 7,440,674 – 7,842,144 | 401,373 | unknown, Hiro-era load |
| Failed burnchain-op txs missing | e.g. 58997 (2 txs) | small | Hiro API drops failed burnchain ops |
| Event encoding | below ~8.2M | all | Hiro API shape (`smart_contract_event`, hex values, renumbered `event_index`); same values, different representation |

`transactions_archive` (reorged txs) has the same status mislabels.

## What is not wrong

- Successful tx status, sender, type, events and transfers in every era.
- No events from rolled-back (`committed:false`) txs are stored anywhere in prod.
- Everything from PoX-5 activation (Stacks 8,665,568) up is node-sourced.

## Repair

No field-by-field patching (founder, 2026-10-19). The v2 feeder (node-sourced,
genesis re-sync) replaces this history at the source/target cutover
(`runbook/db-source-target-cutover.md`), then the archive is re-exported and
re-signed from it. Before cutover, the feeder rolls the 2026-10-19 parser fixes
(burnchain ops, multisig, fork flip-back) and re-parses its affected rows.

A pattern repair of statuses (`(err …)` result ⇒ abort_by_response) was tested
and rejected: ~5% of node-sourced `(err …)` aborts are real post-condition
aborts. Spike scripts and queries: session scratchpad `spike/`, `status-audit/`.

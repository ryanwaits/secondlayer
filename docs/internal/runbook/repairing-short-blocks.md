# Runbook: repairing short blocks from the journal

A **short block** is a canonical height where `transactions` holds fewer (or
different) rows than the block actually contained — `blocks.tx_count`, set at
persist time, no longer matches `count(transactions)` at that height. This
happens when a tx gets moved off its true height by a same-height `tx_id`
collision at a later-arriving block, or (historically, pre-`ca90a500`) the
`onConflict(doNothing)` re-mine bug. Every read of a short height serves wrong
data: missing txs, missing events, wrong per-cycle/per-asset totals downstream.

Two independent detectors catch it — see the ingest transaction completeness
work:

- **`/health/integrity`** → `shortBlocks`: `count(transactions at h) ≠
  blocks.tx_count`, for heights where `tx_count` is set (persisted since the
  `0143_blocks_tx_count` migration; older rows have no baseline).
- **`node-replay-auditor.ts`**: recomputes `txMerkleRoot` over our stored
  txids (ordered by `tx_index`, observer-synthetic boot-deploy txs excluded —
  see `isObserverSyntheticBootTx`) and compares it against the node header's
  own `tx_merkle_root`. A mismatch means our txid set for that height diverges
  from consensus, independent of anything we recorded ourselves.

The indexer also self-heals live: `reconcileReorgedRange` (`reorg.ts`) runs
automatically after every reorg settle and re-persists any height in its
window whose tx_id set diverges from its own canonical `observer_journal`
payload. The tools below are for repairing a **known-bad range that already
shipped** — a backfill this reconcile can't reach, or a range you want to
verify and repair explicitly.

## Source of truth: the observer journal

`observer_journal` holds the exact `/new_block` body the node sent, since
2026-08-11 (height ~8,739,026 on mainnet). The row whose `block_hash` equals
the canonical `blocks.hash` at a height is the only source with both the tx
set AND the executed events for it.

**Do not use `transactions_archive` / `events_archive`** — they hold a
*different* block's execution context (the losing fork's), not the winner's.
The node's raw block bytes have the tx set but no execution results.

A height below the journal's start has no payload to repair from. Nothing here
guesses at those — every tool fails loudly instead.

## 1. Diff (dry-run)

```
bun run packages/indexer/src/repair-from-journal.ts --heights 8777879,8777880
bun run packages/indexer/src/repair-from-journal.ts --from 8777879 --to 8964808
```

Prints a per-height table (`status`, `journal_tx`, `db_tx`, `missing`,
`extra`) and totals. Touches nothing. `status` is one of:

- `match` — nothing to do.
- `diverged` — the journal and `transactions` disagree; `--apply` will fix it.
- `missing_block` — the height isn't canonical (not this tool's job).
- `missing_journal` — no journal payload for this height (pre-journal, or the
  journal was pruned). Cannot be repaired from the journal at all.

Add `--verify-node` to also recompute the stored tx merkle root against a live
node (`--node-url`, default `$STACKS_NODE_RPC_URL` or `localhost:20443`).

## 2. Apply

```
bun run packages/indexer/src/repair-from-journal.ts --from 8777879 --to 8964808 --apply
```

Re-persists every diverged height from its journal payload through the exact
`persistBlock` path live ingest uses — including its fail-loud completeness
assertion, so a repair that can't land completely throws and rolls back rather
than reporting false success. A re-run of the dry-run afterward should report
0 diverged.

## 3. Re-derive downstream decoders

**Run this AFTER the repair above, never before.** A decoded row can
currently be *ahead* of a short source table (e.g. a reorg left
`decoded_events` / `sbtc_token_events` holding rows the source temporarily
lacks) — re-deriving first would wipe those rows before the repair puts the
source back.

`repair-from-journal.ts --apply --derive` prints the exact commands for the
window it just repaired, with `--types`/heights already filled in. Run each
one it prints, or use this table as reference:

| Decoder | Table(s) | Command |
|---|---|---|
| Generic decoded events | `decoded_events` | `bun run packages/indexer/src/rederive-decoded-events.ts --from-height <from> --to-height <to> --types <types> --apply` (types = exactly what the window holds; the `--derive` output fills this in for you) |
| sBTC token transfers | `sbtc_token_events` | `bun run packages/indexer/src/decode/backfill-from-firehose.ts --target sbtc_token --from-height <from> --to-height <to> --apply` |
| PoX-5 staking events | `pox5_events` | `bun run packages/indexer/src/decode/rederive-pox5-events.ts --from-height <from> --to-height <to> --apply` |
| BNS event logs | `bns_name_events`, `bns_namespace_events`, `bns_marketplace_events` | `bun run packages/indexer/src/decode/rederive-bns-events.ts --from-height <from> --to-height <to> --apply` |
| Contracts registry | `contracts` | `bun run packages/indexer/src/contracts/rederive-registry.ts --limit 2000` (no window — anti-joins `transactions` against `contracts` and registers whatever isn't there yet; run it more than once, or raise `--limit`, if a window has more than the default) |

Notes:

- Each tool deletes-then-redecodes ONLY the window given (contracts registry
  is the one exception — it needs no window at all), and never touches a live
  decoder's own checkpoint, so the live decoder stays at tip with zero lag.
- `rederive-bns-events.ts` does **not** rebuild the `bns_names` /
  `bns_namespaces` projections — those are forward-only state, and replaying
  only a bounded historical window through them risks overwriting a name's
  current state with stale data if it was touched again later, outside the
  window. If projections also need fixing for a window, that's a full
  checkpoint-rewind replay (`handleBnsReorg`-style), not this tool.

## 4. Verify

- Re-run the dry-run — expect `diverged: 0` for every height in range.
- `/health/integrity` → `status` should no longer be `short_blocks`, and
  `shortBlocks` should not list any height in the repaired range.
- For a range with downstream aggregates (e.g. pox-5 per-cycle totals),
  replay the aggregate independently against the node and confirm it matches
  — never take the repair's own success on faith for numbers it feeds.

## Prod repair — reviewer/founder-approved only

This is recorded here for the runbook; it is **not** run by whoever authored
the repair tooling — a separate approval gate applies before anything touches
the production database.

1. `repair-from-journal --from <from> --to <to> --dry-run --verify-node`
   against prod; confirm the expected block/tx/event counts.
2. Founder go.
3. `--apply`.
4. Re-run the dry-run — expect 0 diverged.
5. Run the re-derives for the affected windows (step 3 above).
6. Replay any downstream aggregate independently against the node — every
   total must match, with nothing put back by hand.
7. `/health/integrity` → `shortBlocks` is empty.

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

## Republishing the archive after a data repair

A repair above only fixes the source database. The public signed archive and
the Streams bulk dumps are separate, already-published copies of the old
(short) data, and nothing about repairing the source touches them. Skipping
this checklist leaves the archive serving the bad bytes indefinitely. There
is no revoke for a signed snapshot, only a republish plus an incident report.
Run every time a repair above changes canonical `transactions` or `events`
for a range the archive has already covered. Reviewer/founder-approved only,
same gate as the prod repair above.

1. **Republish the archive. [Founder go]**
   - `ssh app-server 'sudo systemctl start secondlayer-archive-publish.service'`
   - Follow `/var/log/secondlayer-archive-publish.log` to `archive-publish OK`.
   - The new snapshot's `counts.transactions` and `counts.events` must be
     higher than the previous snapshot's by at least the repaired row counts
     (plus whatever finalized in the meantime), and `promoted_at` must be
     after the repair. If not, stop, do not promote by hand, and investigate
     before touching anything else.
2. **Verify.**
   - Against the new pointer: `secondlayer verify raw --against
     https://archive.secondlayer.tools/latest.json --from-block <from>
     --to-block <to> --counts --semantic` must exit 0. Run with the source-DB
     URL, from the indexer container or a machine with DB access.
   - Against the OLD snapshot (its digest is in the previous `latest.json`,
     or list `snapshots/` on the host), the same check must exit non-zero
     with a count/digest mismatch on the repaired ranges. This proves the
     check would have caught the old bad data; if it doesn't, the repair or
     the check is wrong, not the archive.
3. **Node attestation for the new digest (recommended).** Run
   `node-replay-auditor.ts` over the repaired range against the new digest
   (see `canonical-archive.md`), expect 0 tx-merkle mismatches, then
   `publish-attestation.ts`.
4. **Re-export the affected Streams dump ranges. [Founder go]** For every 10k
   range the repair touched:
   `docker exec secondlayer-indexer-1 bun run
   packages/indexer/src/streams-bulk/export.ts --from-block <from> --to-block
   <to> --upload --force`. Verify
   `https://api.secondlayer.tools/public/streams/dumps/manifest` shows the
   new `sha256` and a higher `row_count` for each range. Purge any Streams
   CDN cache for those heights if the CDN is live (`streams-cdn.md`).
5. **Incident report. [Founder go: public statement]**
   - Add `docs/incidents/published/<date>-<slug>.json` and an entry in
     `docs/incidents/INCIDENTS.md`. Fields: `id`, `date`, `severity`,
     `affects_archive: true`, `title`, `summary` (heights, row counts, what
     was wrong and why), `root_cause`, `superseded_snapshots` (every snapshot
     promoted before the repair whose coverage reaches the affected range),
     `corrected_snapshot` (the digest from step 1), `consumer_action` (what a
     consumer running `verify --counts` against the old snapshot should do:
     re-bootstrap into an empty database, or run `repair --apply`, then
     re-run their own decoders for the affected heights). Voice: you/your,
     plain, no em dashes.
   - Commit and push. The deploy's `git reset --hard origin/main` lands the
     new file on the host at `/opt/secondlayer/docs/incidents/published/`,
     but the already-running `secondlayer-indexer-1` container still has the
     old image's filesystem, so `docker exec` into it can't see the new file
     until the next image rebuild. `docker cp` it in now instead of waiting:
     `ssh app-server 'docker cp
     /opt/secondlayer/docs/incidents/published/<file>.json
     secondlayer-indexer-1:/app/docs/incidents/published/'`.
   - `ssh app-server 'docker exec secondlayer-indexer-1 bun run
     packages/indexer/src/archive/publish-incidents.ts'` (dry run), confirm
     it lists the new report, then re-run with `--apply`.

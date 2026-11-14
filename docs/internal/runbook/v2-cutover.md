# Runbook: v2 chain DB cutover (feeder → db-server)

Replaces prod's chain DB (SOURCE, Hiro-era history below ~8.2M) with the
node-sourced v2 DB from the genesis feeder, on its own host (db-server). Plans:
031 (cutover), 317 (data gate), 159 (db-server). Founder-driven; every phase
ends at a check, and GO is a named founder decision.

## Shape

```
feeder (FSN1, frozen at H0) ──copy──▶ db-server (HEL1) /data/postgres
                                        migrate → decoders rebuild → 317 checks
prod (app-server PG, live) ── observer_journal H0+1..T ──replay──▶ db-server
GO: stop indexer (node stalls, no gap) → replay last rows → repoint SOURCE → start
```

- **Prod never goes down for the copy, checks, or decoder rebuild.** They run on
  db-server while prod serves from the old DB.
- **Downtime at GO = minutes:** indexer stopped, final journal rows replayed,
  services repointed. The node stalls on `/new_block` while the indexer is
  down and resumes with no gap (seen in the 2026-11-11 outage).
- **The node chainstate swap is NOT in this cutover.** Prod node-server keeps
  its own chainstate on stock stacks-core. The v2 chainstate is kept in the
  snapshot pair and goes to node-server later, with the fork move after a
  4.1-ready fork image passes on the feeder (founder 2026-11-13). This removes
  the 1.5 TB rollback copy and the node downtime from cutover day.

## Facts (measured 2026-11-13/14)

| | |
|---|---|
| Postgres | feeder 17.11, prod 17.11, db-server `postgres:17-alpine` pinned |
| v2 DB | name `secondlayer_feeder`, user `secondlayer`, 821 GB at 91%, ~1 TB at tip |
| v2 migrations | 179 applied, head `0181_push_sent`; prod 208, head `0210_mempool_evict_superseded_nonces` |
| v2 empty tables | `decoded_events` (prod 393 GB), `sbtc_*`, `bns_*`, `pox5_*`, `stage_*`, `contracts` |
| v2 extra | `vm_events` 328 GB, `state_writes` 137 GB, `observer_journal` 185 GB (genesis→H0) |
| Prod journal | `observer_journal` from 8,739,026 (raw `/new_block` bodies, arrival order) |
| db-server | `/data` 3.1 TB free; PG binds 10.77.0.1 (WireGuard) only; WAL-G prefix `pg-db-server` |
| Feeder ↔ db-server | FSN1 → HEL1, ~4–5 h per TB-scale copy (estimate, measure on phase 1) |

## Behaviors that shape the order (code-verified 2026-11-14)

- **Webhooks:** `trigger_evaluator_state.last_processed_block` (TARGET) is a
  height. Heights at or below it are never re-evaluated, so a replay below T
  sends nothing twice. Delivery is capped by decoder checkpoints
  (`decoder-bound.ts:150-166`), so webhooks pause until every decoder is past T.
- **Subgraphs:** `subgraphs.last_processed_block(_hash)` (TARGET). If the hash
  at the cursor differs on the new DB, it rewinds to the fork
  (`reorg-detect.ts:31-56`). Subgraphs that stored Hiro-era `tx.status` need a
  reindex after cutover.
- **Decoders with empty checkpoints:**
  - classic (ft/nft/stx/print): start at genesis;
  - sBTC and pox5: start at tip−1000;
  - BNS: starts at tip.
  sBTC, pox5 and BNS need an explicit backfill (`decode/BACKFILL.md`,
  `backfill-from-firehose.ts`, which keeps its own `backfill.<key>` checkpoints;
  use `--restart`).
- **sBTC settlement cursor bug:** `trigger_evaluator_state.last_settlement_scan_seq`
  holds a SOURCE sequence value (`sbtc_settlements_seq`). The new DB restarts
  it, so settlements would be skipped. A backfilled settlement also gets
  `confirmed_at = now()` and could fire historical webhooks. Fix at GO (5.6).
- **Migrations:** `migrate` runs both planes, with `statement_timeout 60s`.
  `0199` skips on >1M `transactions` rows and expects a manual
  `CREATE UNIQUE INDEX CONCURRENTLY`. Nothing in 0182–0210 rewrites big tables.
- **Mempool page cursors** use a SOURCE insertion sequence: old client cursors
  page wrongly after the swap. Accepted, short-lived.

## Phase 0: prep (now, no feeder contact)

0.1 Write the journal replay tool if none exists. It POSTs `observer_journal`
    `raw_body` rows (by journal id, arrival order) from one DB to an indexer
    `/new_block` bound to another DB. Same parse/persist path as live ingest.
    Dry-run test it on a local DB.
0.2 Plan 317 check 2: run the Hiro TSV replays (`scripts/ops/hiro-tsv/`) into a
    scratch DB now, so the comparison needs only the frozen copy.
0.3 Write the exact 317 SQL (counts per 250k chunk, status distribution,
    per-height digest diff vs prod) as files, so phase 3 is run-only.
0.4 Confirm the 179 v2 `kysely_migration` names are a prefix of the repo's
    migration list.

## Phase 1: freeze + copy (feeder at tip)

1.1 Feeder at tip: `curl -s 127.0.0.1:21443/v2/info` vs the public tip, within
    a few blocks; witness check green for the last 24 h.
1.2 Stop, in order: feeder stacks-node, then the indexer, then Postgres (clean
    shutdown). Record `H0 = max(blocks.height)` and the node tip.
    **The feeder stays stopped. H0 is the snapshot pair.**
1.3 Snapshot pair → db-server `/data/snapshots/` as zstd tars of
    `/mnt/HC_Volume_106907790/{postgres-v2,stacks-v2}` with a sha256 manifest.
1.4 Live copy: rsync `postgres-v2/` → db-server `/data/postgres/`. First
    `docker compose down` on db-server and move the empty cluster aside.
1.5 db-server: `docker compose up -d postgres`, then:
    - `ALTER DATABASE secondlayer_feeder RENAME TO secondlayer`;
    - `ALTER ROLE secondlayer PASSWORD` the db-server `.env` value (never echo it).
1.6 WAL-G: the cluster changed (new system id). Point `WALG_S3_PREFIX` at a fresh
    prefix (`pg-db-server-v2`), `up -d walg-backup`, then confirm a base backup lists.

**Verify:**
- `SELECT max(height), count(*) FROM blocks` matches H0, from an app-server
  container over the tunnel.
- The tar manifests match.

## Phase 2: bring the copy to prod schema + decoders

2.1 Migrate: one-off `migrate` with `SOURCE_DATABASE_URL=db-server`, TARGET
    unchanged. TARGET is already at head, so it's a no-op there.
2.2 Hand-build the 0199 index (`CREATE UNIQUE INDEX CONCURRENTLY
    transactions_height_tx_index_uniq ON transactions (block_height, tx_index)`,
    after the duplicate check in the 0199 header). Time it. Then drop the
    plain index it covers, which the migrate run kept because the unique index
    didn't exist yet (NOTICE "transactions_block_height_idx kept"):
    `DROP INDEX CONCURRENTLY IF EXISTS transactions_block_height_idx;`
    If the migrate log also said "events_block_height_idx kept", check
    `events_height_type_idx` / `events_logical_id_uniq` exist and are valid,
    then drop it the same way.
2.3 Decoder rebuild against db-server:
    - Before the rebuild (table empty, migrated): drop the three filter
      composites so the genesis load doesn't maintain them row by row:
      `DROP INDEX decoded_events_contract_height_event_idx,
       decoded_events_sender_height_event_idx,
       decoded_events_recipient_height_event_idx;`
      Keep the primary key (`cursor`, the upsert target),
      `decoded_events_block_height_idx` (reorg delete),
      `decoded_events_type_height_event_idx` (checkpoint rewind, tip, floor) and
      `decoded_events_evt_canon_created_idx` (the decoder's own health probe
      runs every 30-60 s; without it that probe scans the whole table).
    - One-off decoder container on app-server with `SOURCE_DATABASE_URL=db-server`
      and `SBTC_DECODER_ENABLED=false POX5_DECODER_ENABLED=false
      BNS_DECODER_ENABLED=false`, so it runs the in-process classic loop only
      (classic decoders start at genesis on empty checkpoints).
      Why the protocol loops are disabled: they read events over HTTP from
      `STREAMS_API_URL` (`decoders/sbtc.ts:366`, `pox-5.ts:184`, `bns.ts:285`),
      i.e. the prod api on the OLD database. They would decode old-DB rows into
      the new one.
    - Protocol tables are filled by the scripts below. They read the new DB
      in-process through `getSourceDb()`, so run each with
      `SOURCE_DATABASE_URL=db-server`. All are dry-run unless `--apply` is given.
      - sBTC (run only after the classic decoders' `ft_mint` output covers the
        range: `fillDepositRecipients` reads the `decoded_events` `ft_mint` rows):
        `bun run packages/indexer/src/decode/backfill-from-firehose.ts --target sbtc --from-height 0 --restart --apply`.
        `--to-height` defaults to the new DB's canonical tip. `--restart`
        ignores the script's own `backfill.<key>` checkpoint.
      - PoX-5 (`backfill-from-firehose` has no pox5 entry):
        `bun run packages/indexer/src/decode/rederive-pox5-events.ts --from-height 0 --to-height <tip> --apply`
        then rebuild the cycle rollup that `/pox/cycles` reads:
        `bun run packages/indexer/src/decode/rebuild-pox5-cycles.ts --apply`.
      - BNS (no `backfill-from-firehose` entry either):
        `bun run packages/indexer/src/decode/rederive-bns-events.ts --from-height 0 --to-height <tip> --apply`.
        This fills `bns_name_events` / `bns_namespace_events` /
        `bns_marketplace_events` only. It does NOT build the `bns_names` /
        `bns_namespaces` projections (no product reader today). Leave them
        empty unless the founder wants a full BNS replay.
      - Before GO (phase 5.3), rerun each of these up to T, the old DB's
        frozen tip. The prod decoder's protocol loops start from empty
        checkpoints at about tip-1000 (sBTC, PoX-5) or tip (BNS), so the
        backfilled range must reach at least that far. Overlap rewrites the
        same rows (upsert on cursor).
    - After the classic decoders reach H0, recreate the three composites
      exactly as the migration defines them (schema parity), with no readers
      attached yet so a plain build is fine:
      `SET maintenance_work_mem = '8GB'; SET max_parallel_maintenance_workers = 8;`
      `CREATE INDEX decoded_events_contract_height_event_idx ON decoded_events (contract_id, block_height, event_index) WHERE contract_id IS NOT NULL;`
      (same for `sender`, `recipient`). Compare `pg_indexes.indexdef` with a
      freshly migrated dev database: identical.
    Live prod decoders are untouched. Track rate; this is likely the long pole.
2.4 Journal catch-up: replay prod `observer_journal` H0+1..now into db-server
    (0.1 tool), then keep re-running it to stay close behind.

**Verify:** every `decoder_checkpoints` row ≥ H0; `kysely_migration` head = prod head.

## Phase 3: data gate (plan 317) → GO

3.1 Run checks 1–5 against db-server (the copy at H0 + journal rows). Results
    go into `docs/internal/audits/hiro-era-history-2026-10-19.md`.
3.2 Extra: decoded-row counts per decoder per 1M heights, v2 vs prod. Any
    difference must be a known Hiro-era difference.
3.3 **Founder GO** on the 317 summary. No GO = stop; prod is untouched.

## Phase 4: pre-GO (same day)

4.1 Fresh WAL-G base backup of the **old** prod chain DB (rollback).
4.2 db-server backup listed; journal replay within ~100 blocks of tip;
    decoders within ~100 blocks.
4.3 Pick a low-traffic window. Any push to main causes a 1–2 min 502, so hold
    deploys.

## Phase 5: GO (minutes)

5.1 app-server: stop `indexer` (prod hetzner overlay, never plain compose).
    The node stalls on `/new_block`; old DB frozen at T = its `max(height)`.
5.2 Replay the last journal rows (≤ T) into db-server. Verify
    `max(height) = T` and that heights/hashes match the old DB for T−100..T.
5.3 Let decoders on db-server reach T, then stop the one-off decoder.
5.4 `.env`: `SOURCE_DATABASE_URL` → `postgres://…@10.77.0.1:5432/secondlayer`.
    Keep the old value commented for rollback. `TARGET_DATABASE_URL` unchanged.
5.5 Start the indexer, decoder, api, worker and subgraph-processor on the new
    URL (hetzner overlay). The node resumes and delivers T+1.
5.6 sBTC cursor:
    `UPDATE trigger_evaluator_state SET last_settlement_scan_seq = (SELECT max(seq) FROM sbtc_settlements on db-server)`
    so backfilled history never fires, then `last_settlement_scan_at = now()`.
    Run before the worker's first tick, with the worker stopped until done.

**Verify (first 30 min):**
- Index tip advances past T, `/status` green, decoder lag ~0.
- `trigger_evaluator_state.last_processed_block` moving; webhook deliveries
  flowing with no duplicates (dedup keys).
- Subgraph cursors moving.
- Husk canaries pass (`count(*)` + sample `EXISTS`, `docker/PRODUCTION.md` rule 5).
- `SELECT 1` latency over the tunnel ~0.5 ms.

## Rollback (any time in the first 7 days)

Point `SOURCE_DATABASE_URL` back to the old DB (kept read-only and untouched),
replay its missing tail from the new DB's `observer_journal` (same tool,
reversed), restart. The old DB is deleted only after 7 green days + founder go.

## After

- Plan 317 "After cutover": archive re-export, re-sign, verify; reindex
  subgraphs storing `tx.status`.
- Measure week-1 DB growth on db-server.
- Feeder: stays stopped. The fork dry run (sl/4.0.7) can run on it from H0 now
  that the pair is snapshotted.
- Later (post-4.1): node chainstate swap to v2 + fork image. Its own runbook
  step: rollback copy of prod `/data/stacks` (1.5 TB) to the feeder volume,
  then swap. Delete the feeder only after that, with founder go.

## Open before GO

- Decoder rebuild time from genesis (phase 2.3): unknown, measure.
- Journal replay tool (0.1): confirm whether one exists; else write and test it.

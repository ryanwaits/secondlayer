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
                           (/new_block + /new_burn_block, by sequence)
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
| v2 migrations | 179 applied, head `0181_push_sent`; repo head `0216_events_total_baseline`. Pending on v2: 0182–0216 (35) |
| v2 empty tables | `decoded_events` (prod 393 GB), `sbtc_*`, `bns_*`, `pox5_*`, `stage_*`, `contracts` |
| v2 extra | `vm_events` 328 GB, `state_writes` 137 GB, `observer_journal` 185 GB (genesis→H0) |
| VM data after H0 | `vm_events` / `state_writes` end at H0 until the node swap (stock journal bodies carry none); VM readers see empty ranges after H0 that look real |
| Prod journal | `observer_journal` from 8,739,026 (raw `/new_block` bodies, arrival order) |
| db-server | `/data` 3.1 TB free; PG binds 10.77.0.1 (WireGuard) only; WAL-G prefix `pg-db-server` |
| Feeder ↔ db-server | FSN1 → HEL1, ~4–5 h per TB-scale copy (estimate, measure on phase 1) |

## Behaviors that shape the order (code-verified 2026-11-14)

- **Webhooks:** `trigger_evaluator_state.last_processed_block` (TARGET) is a
  height. Heights at or below it are never re-evaluated, so a replay below T
  sends nothing twice. Delivery is capped by decoder checkpoints
  (`decoder-bound.ts:150-166`), so webhooks pause until every decoder is past T.
  The cursor lives in each stack's TARGET database (hosted tenants, testnet),
  not one app-server database.
- **Subgraphs:** `subgraphs.last_processed_block(_hash)` (TARGET). If the hash
  at the cursor differs on the new DB, it rewinds to the fork
  (`reorg-detect.ts:31-56`). Subgraphs that stored Hiro-era `tx.status` need a
  reindex after cutover. Subgraph cursors also live in each stack's TARGET
  database (hosted tenants, testnet).
- **Decoders with empty checkpoints:**
  - classic (ft/nft/stx/print): start at genesis;
  - sBTC and pox5: start at tip−1000;
  - BNS: starts at tip, only if prod sets `BNS_DECODER_ENABLED=true` (default
    off, `packages/shared/src/env.ts`). Check prod `.env` before GO.
  sBTC, pox5 and BNS need an explicit backfill (`decode/BACKFILL.md`,
  `backfill-from-firehose.ts`, which keeps its own `backfill.<key>` checkpoints;
  use `--restart`).
- **Reorgs rewind decoders:** a reorg replayed into the copy resets each
  classic decoder to its own last row below the fork (genesis if it has none)
  and deletes `decoded_events` at or above the fork. Start journal replay only
  after the classic rebuild passes H0.
- **Protocol scripts and reorgs:** `backfill-from-firehose`,
  `rederive-pox5-events` and `rederive-bns-events` write outside the apply
  lock. A reorg between their read and write can resurrect orphaned rows.
  Pause journal replay while they run.
- **sBTC settlement cursor:** the settlement confirmer
  (`decode/settlement.ts`, `SBTC_SETTLEMENT_CONFIRMER_ENABLED=true`, needs
  bitcoind RPC) is the only writer of `sbtc_settlements`. On the new DB the
  table starts empty, and every historical sweep gets a fresh
  `sbtc_settlements_seq` value and `confirmed_at = now()` as it confirms. The
  cursor `trigger_evaluator_state.last_settlement_scan_seq` lives in each
  stack that runs `webhook-service` (hosted tenants via
  `docker/workload/tenant.compose.yml`, plus testnet), in its TARGET database.
  Unmoved, those stacks resend every historical settlement webhook. Fix: drain
  the confirmer (2.5), then set every cursor (5.6).
- **Migrations:** `migrate` runs both planes, with `statement_timeout 60s`.
  Kysely runs all pending migrations in ONE transaction, so one statement over
  60 s rolls back all 34, and every rerun hits the same wall. Two statements
  scan big tables on the copy: `0191` `VALIDATE CONSTRAINT` (full scan of
  `observer_journal`, 185 GB) and the `0210` mempool DELETE (only if
  `mempool_transactions` has rows). Time both first (2.1).
  `0199` skips on >1M `transactions` rows and expects a manual
  `CREATE UNIQUE INDEX CONCURRENTLY`.
- **Mempool page cursors** use a SOURCE insertion sequence: old client cursors
  page wrongly after the swap. Accepted, short-lived.

## Phase 0: prep (now, no feeder contact)

0.1 The replay tool is `packages/indexer/src/replay-journal.ts`.
    - Replays `/new_block` AND `/new_burn_block` rows with status `processed`
      or `received`, in `sequence` order. Burn rewards come only from
      `/new_burn_block`; the node never re-sends them.
    - Skips and counts `failed`, `retried`, `skipped`, `poisoned` rows.
    - Stops on any reply other than applied; prints `last_sequence=<n>` last,
      to resume from.
    - Dry-run unless `--apply`. Flags: `--source-url`, `--indexer-url`,
      `--network` (default `mainnet`), `--from-sequence N` (exclusive) or
      `--from-height H --margin N` (default 200), `--to-sequence`,
      `--page-size`, `--timeout-ms`, `--apply`.
    - Example: `bun run packages/indexer/src/replay-journal.ts --source-url <prod PG url> --indexer-url http://127.0.0.1:3700 --from-sequence <last_sequence> --apply`
    - Dry-run it on a local DB pair first.
0.2 Plan 317 check 2 is a self-replay of v2's own `observer_journal` (no Hiro).
    Prepare its scratch DB and window list now. The replay tool can drive it
    into a scratch indexer.
0.3 Write the exact 317 SQL (counts per 250k chunk, status distribution,
    per-height digest diff vs prod) as files, so phase 3 is run-only.
0.4 Confirm the 179 v2 `kysely_migration` names are a prefix of the repo's
    migration list.
0.5 Replay indexer config: one-off indexer container with
    `SOURCE_DATABASE_URL=db-server`, `INGEST_MODE=live` (else it can reply
    `accepted` before applying), `TIP_FOLLOWER_ENABLED=false`,
    `AUTO_BACKFILL_ENABLED=false`, `STREAMS_BULK_PUBLISHER_ENABLED=false`,
    `CONTRACT_REGISTRY_ENABLED=false`. It must be the only indexer on
    db-server (leader-only loops double-write otherwise); stop it before 5.5.
    Bind it to loopback or WireGuard only.
0.6 sBTC confirmer config: the one-off decoder for db-server needs
    `SBTC_SETTLEMENT_CONFIRMER_ENABLED=true` and bitcoind RPC env, the same
    names prod's decoder uses (`BITCOIN_RPC_URL` plus `BITCOIN_RPC_AUTH` or
    `BITCOIN_RPC_USERNAME`/`BITCOIN_RPC_PASSWORD`). Never echo the credentials.

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
    prefix (`pg-db-server-v2-enc`), `up -d walg-backup`, then confirm a base backup lists.
    Backups are encrypted: `WALG_LIBSODIUM_KEY` is already in db-server's `.env`
    (same key as app-server, copy in `/root/walg-libsodium.key` on both hosts).
    Keep it; a backup without its key cannot be restored.

**Verify:**
- `SELECT max(height), count(*) FROM blocks` matches H0, from an app-server
  container over the tunnel.
- The tar manifests match.

## Phase 2: bring the copy to prod schema + decoders

2.1 Timing pre-step on the copy, then migrate.
    - `SET statement_timeout = 0; EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM observer_journal WHERE NOT (status IN ('received','processed','failed','retried','poisoned','skipped'));`
    - `SELECT count(*) FROM mempool_transactions;` (0 means the 0210 DELETE is
      a no-op).
    - If either runs over ~45 s: STOP and ask the founder. Never edit a
      migration or the timeout on the day.
    - Then one-off `migrate` with `SOURCE_DATABASE_URL=db-server`, TARGET
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
      `decoded_events_type_height_event_idx` (checkpoint rewind, tip, floor).
      Decoder health reads `decoder_checkpoints.last_output_at` since 0215, so
      no health-probe index is needed.
    - One-off decoder container on app-server with `SOURCE_DATABASE_URL=db-server`
      and `SBTC_DECODER_ENABLED=false POX5_DECODER_ENABLED=false
      BNS_DECODER_ENABLED=false`, so it runs the in-process classic loop only
      (classic decoders start at genesis on empty checkpoints).
      Why the protocol loops are disabled: they read events over HTTP from
      `STREAMS_API_URL` (`decoders/sbtc.ts:199`, `pox-5.ts:159`, `bns.ts:242`),
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
      - Before GO (phase 5.3), rerun each up to T, the old DB's frozen tip. The
        prod decoder's protocol loops start from empty checkpoints at about
        tip-1000 (sBTC, PoX-5) or tip (BNS), so the backfilled range must reach
        at least that far. Rerun the new range only:
        - `rederive-pox5-events.ts` and `rederive-bns-events.ts` with
          `--from-height <previous run's --to-height + 1> --to-height <T>`.
          Never `--from-height 0` again: these scripts delete the window first.
        - `backfill-from-firehose` with its own checkpoint (no `--restart`) and
          the same `--to-height`. It upserts, so overlap is safe.
        - Then `rebuild-pox5-cycles.ts --apply`.
        Pause the journal replay while any of them runs.
    - After the classic decoders reach H0, recreate the three composites
      exactly as the migration defines them (schema parity), with no readers
      attached yet so a plain build is fine:
      `SET maintenance_work_mem = '8GB'; SET max_parallel_maintenance_workers = 8;`
      `CREATE INDEX decoded_events_contract_height_event_idx ON decoded_events (contract_id, block_height, event_index) WHERE contract_id IS NOT NULL;`
      (same for `sender`, `recipient`). Compare `pg_indexes.indexdef` with a
      freshly migrated dev database: identical.
    Live prod decoders are untouched. Track rate; this is likely the long pole.
2.4 Journal catch-up (0.1 tool), into the replay indexer (0.5).
    - **Start condition:** only after every classic `decoder_checkpoints` row
      is ≥ H0. `SELECT decoder_name, last_cursor FROM decoder_checkpoints WHERE decoder_name LIKE 'decode.%' ORDER BY 1;`
      (cursor is `<height>:<index>`).
    - **First run:** `--from-height <H0> --margin 200 --apply`.
    - **Then:** repeat with `--from-sequence <last_sequence>` to stay close
      behind.
    - **Pause** while the protocol scripts (2.3) run.
    - **After each run:** `SELECT status, count(*) FROM observer_journal WHERE status IN ('poisoned','failed') GROUP BY 1;`
      on db-server. Any row means STOP and look; do not continue.
2.5 sBTC confirmer drain: run the one-off decoder with the confirmer on (0.6)
    until `readPendingSweeps` (`decode/settlement.ts`) is empty.
    - SQL on db-server: count `sbtc_events` rows with `canonical`,
      `topic = 'withdrawal-accept'`, `sweep_txid` and `request_id` not null, with
      no confirmed `sbtc_settlements` row. Copy the WHERE logic from
      `readPendingSweeps`.
    - Expect a small number: sweeps still under the watch depth, or
      unconfirmed on Bitcoin.
    - Record `SELECT max(seq) FROM sbtc_settlements` after the drain.

**Verify:** every `decoder_checkpoints` row ≥ H0; `kysely_migration` head = prod head;
journal replay `last_sequence` recorded; 0 poisoned/failed rows; settlement drain done.

## Phase 3: data gate (plan 317) → GO

3.1 Run checks 1–5 against db-server (the copy at H0 + journal rows). Results
    go into `docs/internal/audits/hiro-era-history-2026-10-19.md`.
3.2 Extra: decoded-row counts per decoder per 1M heights, v2 vs prod. Any
    difference must be a known Hiro-era difference.
3.3 **Founder GO** on the 317 summary. No GO = stop; prod is untouched.

## Phase 4: pre-GO (same day)

4.1 Fresh WAL-G base backup of the **old** prod chain DB (rollback).
4.2 db-server backup listed; journal replay within ~100 blocks of tip;
    decoders within ~100 blocks; replay indexer still the only indexer on
    db-server; 0 poisoned/failed journal rows.
4.3 Pick a low-traffic window. Any push to main causes a 1–2 min 502, so hold
    deploys.

## Phase 5: GO (minutes)

5.1 app-server: stop BOTH `indexer` and `decoder` (prod hetzner overlay, never
    plain compose), so no settlement confirmations land on the old DB after T.
    The node stalls on `/new_block`; old DB frozen at T = its `max(height)`.
5.2 Replay with `--from-sequence <last_sequence> --apply` until `last_sequence`
    stops moving. Verify `max(height) = T`, hashes match the old DB for
    T−100..T, and `SELECT count(*) FROM blocks WHERE canonical AND height BETWEEN <H0> AND <T>`
    equals `T − H0 + 1` on db-server. Plus 0 poisoned/failed journal rows.
5.2b Stop the replay indexer.
5.3 Let decoders on db-server reach T. Run the protocol reruns (2.3 "Before
    GO") up to T. Then stop the one-off decoder. Leave the confirmer drained.
5.4 `.env`: `SOURCE_DATABASE_URL` → `postgres://…@10.77.0.1:5432/secondlayer`.
    Keep the old value commented for rollback. `TARGET_DATABASE_URL` unchanged.
5.5 Start the indexer, decoder, api, worker and subgraph-processor on the new
    URL (hetzner overlay). The node resumes and delivers T+1.
5.6 sBTC cursor, in EVERY stack running `webhook-service` with an
    `sbtc_withdrawal_swept_confirmed` subscription (each hosted tenant stack,
    plus testnet). With those `webhook-service` instances stopped, in each
    stack's TARGET database:
    `UPDATE trigger_evaluator_state SET last_settlement_scan_seq = <db-server max(seq) from 2.5 drain>, last_settlement_scan_at = now()`.
    Then start them. The UPDATE must run before any `webhook-service` scans
    the new database. App-server's `worker` does not run this scan.

**Verify (first 30 min):**
- Index tip advances past T, `/status` green, decoder lag ~0.
- `trigger_evaluator_state.last_processed_block` moving; webhook deliveries
  flowing with no duplicates (dedup keys).
- Subgraph cursors moving.
- No settlement webhook for a sweep confirmed before GO.
- Husk canaries pass (`count(*)` + sample `EXISTS`, `docker/PRODUCTION.md` rule 5).
- `SELECT 1` latency over the tunnel ~0.5 ms.

## Rollback (any time in the first 7 days)

Point `SOURCE_DATABASE_URL` back to the old DB (kept read-only and untouched),
replay its missing tail from the new DB's `observer_journal` with
`replay-journal.ts` (`--source-url` = new DB, target indexer on the old DB
with the 0.5 config, `--from-sequence` = the new DB's first journal sequence
after GO), restart. The old DB is deleted only after 7 green days + founder go.

## After

- Plan 317 "After cutover": archive re-export, re-sign, verify; reindex
  subgraphs storing `tx.status`.
- Measure week-1 DB growth on db-server.
- VM data on db-server resumes only after the node swap; until then do not
  advertise VM ranges past H0.
- Feeder: stays stopped. The fork dry run (sl/4.0.7) can run on it from H0 now
  that the pair is snapshotted.
- Later (post-4.1): node chainstate swap to v2 + fork image. Its own runbook
  step: rollback copy of prod `/data/stacks` (1.5 TB) to the feeder volume,
  then swap. Delete the feeder only after that, with founder go.

## Open before GO

- Decoder rebuild time from genesis (phase 2.3): unknown, measure.
- Timing of the 0191/0210 scans on the copy (2.1 pre-step).
- Settlement drain time (bitcoind calls, one per sweep).
- Whether prod sets `BNS_DECODER_ENABLED` and
  `SBTC_SETTLEMENT_CONFIRMER_ENABLED`.

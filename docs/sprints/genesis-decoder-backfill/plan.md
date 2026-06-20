# P0: Genesis-complete every decoder (the index service's core contract)

The index service promises **every block from genesis, decoded and supplied** — that's the SDK's
entire pitch for devs building their own indexers. A floored decoder silently serves incomplete
history = a correctness defect. **No new features until every decoder is verified genesis-complete.**

## Audit (2026-06-20, `min(block_height)` per decoder table on prod)

| decoder → table | floor | genesis? |
|---|---|---|
| ft_transfer, ft_mint, ft_burn → decoded_events | 4846 / 4763 / 8069 | ✅ |
| print → decoded_events | 32 (backfilling now) | ✅ in progress |
| sbtc_events / sbtc_token / pox4_calls / bns_name_events (dedicated) | 328312 / 329351 / 147294 / 167540 | ✅ (= contract deploy) |
| **stx_transfer → decoded_events** | **6,802,057** | ❌ |
| **stx_mint / stx_burn / stx_lock** | 6,802,238 / 6,802,071 / 6,807,924 | ❌ |
| **nft_transfer** | **7,800,002** | ❌ (worst) |
| **nft_mint / nft_burn** | 6,802,071 / 6,804,537 | ❌ |

**Root cause:** these decoders were added go-forward (after the original ft/nft-transfer genesis
backfill) and never backfilled — the launch-time backfill was paused (`BACKFILL.md`, 2026-05-27) and
never resumed. `backfill-from-firehose.ts` *wrongly* lists the generic decoders as "already-genesis,"
which hid it.

## Mechanism — backfill WITHOUT lagging live (the requirement)

Two tools exist; the choice is dictated by "don't disrupt live ingestion":

- **`reset-checkpoints.ts`** rewinds the *live* checkpoint → the decoder reprocesses genesis→tip and
  **lags live** for the duration. No blocks are *lost* (the indexer ingests independently; the
  decoder catches up), but for high-volume `stx_transfer` the lag could be **days**. Used for `print`
  (already in flight) since it was the active one; acceptable for moderate volume, not for stx.
- **`backfill-from-firehose.ts`** reads the **indexer DB** (full genesis, bypasses streams retention)
  on a **separate checkpoint namespace** → the live decoder stays at tip (**zero lag**) while history
  fills in parallel. **This is the right tool for the 7 floored decoders.** Today it only has
  `sbtc`/`sbtc_token` entries (per-contract); the generic ones need registering.

## Plan

**Sprint A — make the firehose tool cover generic decoders (code).**
- Make `BackfillEntry.contractId` optional (generic decoders have no single contract); the firehose
  read must accept "all contracts of this event type."
- Register the 7 floored entries: each decodes via its SDK fn (`decodeStxTransfer`, `decodeNftTransfer`,
  …) and writes to `decoded_events` (the generic `writeDecodedEvents` in `storage.ts`).
- Unit-test each entry round-trips a fixture → correct `decoded_events` row. Validate vs live decoder
  output on a sample range.

**Sprint B — run, parallel to live, grouped (cheap → heavy).**
- Order by volume: `stx_lock` / mints / burns / `nft_*` first, **`stx_transfer` last** (heaviest).
- Run `backfill-from-firehose.ts --from-height 1 --to-height <each floor> --apply` per group; monitor
  to genesis; live decoders untouched (no lag). `--from-height 1` = true block-1 genesis.
- Let the in-flight `print` reset-checkpoints backfill finish (already at block 32).

**Sprint C — verify + prevent recurrence.**
- Re-run the floor audit → every decoder `min(block_height)` ≤ its genesis/contract-deploy.
- Fix the false "already-genesis" comment in `backfill-from-firehose.ts`.
- **Add a health/CI guard:** assert each decoder's floor is at genesis (alert if a new go-forward
  decoder ships without a backfill) — so this never silently recurs.

## Guarantees
- **No lost live blocks:** the indexer ingests live independently; the firehose backfill uses a
  separate checkpoint and reads the DB — live decoding never pauses.
- **Idempotent:** `decoded_events` writes are `ON CONFLICT` upserts (the migration-0101 dedupe is
  done — `events_logical_id_uniq` present), so overlapping ranges are safe.

## Done = the floor audit shows every `decode.*` at genesis, and the guard prevents regression.

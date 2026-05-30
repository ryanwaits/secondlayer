# Runbook: indexer DB backup, restore, and the empty-volume guard

The platform's Postgres holds the chain data (100s of GB: `blocks` / `transactions` / `events` / `decoded_events` + platform tables). **Everything reads from it** — Streams, Index, datasets, subgraphs, L2 decoders. Losing it (or, more insidiously, *silently serving the wrong/empty one*) takes the whole product down. This runbook covers the guard against that, the backup strategy, and restore.

## The footgun (what bit us 2026-05-30)

`docker compose run` on a service with `depends_on: postgres` **recreates the postgres container** as a side effect. If that ever surfaces a fresh/empty data dir, the DB reads near-empty (high tip via live ingest, but no history) while `/public/status` still shows "healthy" (it measured *freshness*, not *completeness*). An hour was spent diagnosing phantom "data loss."

**Rule:** never `docker compose run` a postgres-dependent service. For one-off DB tasks use `docker exec <running-container>` or direct `psql`. (Prod mounts the data as a **bind mount** to a host dir, plus a `/wal_archive` bind mount — see backup below.)

## The guard (shipped)

Two backstops now make an empty/wrong volume loud instead of silent:

1. **Indexer startup guard** — `checkChainDataIntegrity` (`@secondlayer/shared/db/queries/integrity`): if the tip is high (> `checkFloor`, default 1,000,000) but a window of canonical blocks ~500k below it is missing, it logs `DB INTEGRITY ALERT: ... wrong or empty Postgres volume?`. Set `REQUIRE_INTEGRITY=true` to **fail-closed** (refuse to start) instead of just warning.
2. **`/public/status` → `chainIntegrity`** — the same check runs per status poll. On failure the top-level `status` degrades (monitoring/Staging Health alarms), but no core *service* is marked down, so a transient false positive can't trip the deploy smoke gate.

**Alert on:** `chainIntegrity.ok == false` in `/public/status`, and the indexer's `DB INTEGRITY ALERT` log line.

## Backup strategy

Tiered, smallest-effort-first.

### v1 — offsite PITR to R2 (WAL-G)  ← do this
Prod already bind-mounts `/wal_archive`, so WAL archiving is partly wired. Finish it with **WAL-G** (single binary, S3/R2-native):
- `archive_command` ships WAL segments to `/wal_archive` → WAL-G pushes to R2.
- Weekly base backup (`wal-g backup-push`) + continuous WAL → **point-in-time recovery**.
- Chain data is append-only ⇒ tiny daily deltas; ~full set compresses well.
- Run WAL-G as a small sidecar in the compose stack; reuse the R2 creds already used for Streams dumps.

> TODO (needs R2 bucket/creds): wire the WAL-G sidecar + `archive_command`, then fill in the exact restore commands below and **test the restore once**.

### v2 — local fast snapshot (optional)
Nightly `pg_basebackup` to the local data disk (plenty of free space), keep last N — instant local restore if the volume is fine but data got clobbered. Or move PGDATA onto ZFS/LVM for instant copy-on-write snapshots.

### Last resort — cold rebuild from chain
`packages/indexer/src/bulk-backfill.ts` with `BACKFILL_SOURCE=archive` rebuilds `blocks`/`transactions`/`events` from Hiro's ~25GB event archive (`archive.hiro.so`), replaying gap heights through the indexer's `/new_block`. Slow (hours) but zero external dependency. Run it **inside** the indexer container (`localhost:3700` ingest), with `ARCHIVE_DIR=/data/archive`, `BACKFILL_FROM`/`BACKFILL_TO` set explicitly. (Fixed 2026-05-30 — it previously crashed on large gap sets.)

## Restore drill (WAL-G — fill in once v1 is wired)

```
# 1. Stop the stack writers (keep postgres image available)
# 2. Provision an empty PGDATA, then:
#    wal-g backup-fetch $PGDATA LATEST
#    configure recovery (restore_command = wal-g wal-fetch) + recovery_target_time
# 3. Start postgres, let it replay WAL to the target, promote
# 4. Verify: SELECT count(*), min(height), max(height) FROM blocks;
#    and curl /public/status → chainIntegrity.ok == true
# 5. Start the rest of the stack
```

**Test this end-to-end once** against a scratch instance so it's proven, not theoretical.

## Quick sanity checks

```bash
# Is the DB the full one? (run from app-server)
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -tA \
  -c "SELECT pg_size_pretty(pg_database_size(current_database())), count(*), min(height), max(height) FROM blocks"

# Integrity from anywhere
curl -s https://api.secondlayer.tools/public/status | jq '.status, .chainIntegrity'
```

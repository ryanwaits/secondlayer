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

### v1 — offsite PITR to R2 (WAL-G)  ← wired, apply when the bucket exists
Postgres already archives WAL to `/wal_archive` (`archive_mode=on`). The
**`walg-backup` sidecar** (`docker/walg/`, added to `docker-compose.hetzner.yml`)
finishes the job: a spooler ships each archived segment to R2 and deletes it
(also bounding the local `/wal_archive`), plus a weekly `wal-g backup-push` with
`delete retain FULL 4`. Base + WAL = **point-in-time recovery**.

**Apply (one-time):**
1. Create a **private** R2 bucket `secondlayer-db-backups` (NOT the public dumps
   bucket). By default the sidecar reuses the `STREAMS_BULK_R2_*` creds; set
   `WALG_*` overrides in `.env` only if you mint scoped creds.
2. Set `WALG_S3_PREFIX=s3://secondlayer-db-backups/pg` in the prod `.env`
   (see `docker/.env.hetzner.example`).
3. Deploy. The sidecar will take a first base backup immediately, then weekly.
4. Verify: `docker logs secondlayer-walg-backup-1` shows `base backup complete`;
   `docker exec secondlayer-walg-backup-1 wal-g backup-list` lists it.
5. After the first base backup succeeds, the old pre-WAL-G segments still sitting
   in `/wal_archive` get spooled up + removed automatically.

### v2 — local fast snapshot (optional)
Nightly `pg_basebackup` to the local data disk (plenty of free space), keep last N — instant local restore if the volume is fine but data got clobbered. Or move PGDATA onto ZFS/LVM for instant copy-on-write snapshots.

### Last resort — cold rebuild from chain
`packages/indexer/src/bulk-backfill.ts` with `BACKFILL_SOURCE=archive` rebuilds `blocks`/`transactions`/`events` from Hiro's ~25GB event archive (`archive.hiro.so`), replaying gap heights through the indexer's `/new_block`. Slow (hours) but zero external dependency. Run it **inside** the indexer container (`localhost:3700` ingest), with `ARCHIVE_DIR=/data/archive`, `BACKFILL_FROM`/`BACKFILL_TO` set explicitly. (Fixed 2026-05-30 — it previously crashed on large gap sets.)

## Restore drill (WAL-G)

Run from a box with `wal-g` + the same `WALG_S3_PREFIX`/R2 env (e.g. exec into
the `walg-backup` sidecar, or a one-off container from `docker/walg`).

```bash
# 0. Stop the stack writers (api/indexer/etc.); keep the postgres image.
# 1. Empty target data dir, fetch the base backup into it:
wal-g backup-list                       # pick a base (or LATEST)
wal-g backup-fetch /var/lib/postgresql/data LATEST

# 2. Configure recovery for PITR (postgres 17):
#    in postgresql.auto.conf (or -c flags):
#      restore_command = 'wal-g wal-fetch %f %p'
#      recovery_target_time = '2026-05-30 17:00:00+00'   # omit to replay all WAL
#    and: touch /var/lib/postgresql/data/recovery.signal

# 3. Start postgres → it replays WAL to the target, then promotes.

# 4. Verify before reattaching the stack:
psql -tA -c "SELECT pg_size_pretty(pg_database_size(current_database())), count(*), min(height), max(height) FROM blocks"
curl -s https://api.secondlayer.tools/public/status | jq '.status, .chainIntegrity'   # chainIntegrity.ok == true

# 5. Start the rest of the stack.
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

# Tenant Backups — Operations Guide

Per-tenant Postgres backups. Every running `sl-pg-<slug>` container gets
dumped hourly with `pg_dump -Fc -Z9` (custom format, compressed) to disk,
then rsync'd to the Hetzner Storage Box.

## Layout

```
/opt/secondlayer/data/backups/tenants/
  <slug>/
    2026-04-19T00-00-00Z.dump    # hourly
    2026-04-19T01-00-00Z.dump
    ...
```

Storage Box mirror:
```
${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${STORAGEBOX_PATH}/tenants/<slug>/*.dump
```

## Retention

Enforced by `backup-prune.sh` every hour at :30.

| Age | Kept |
|---|---|
| 0–7 days | all hourlies |
| 7–30 days | first dump of each day only |
| >30 days | deleted |

Upstream Storage Box uses `rsync --delete` so deletions propagate.

## Cadence

| Time | Unit | Action |
|---|---|---|
| :00 (+≤5 min jitter) | `secondlayer-backup-tenant.service` | `pg_dump` each tenant |
| :30 | `secondlayer-backup-prune.service` | prune local tree |
| :45 (+≤5 min jitter) | `secondlayer-backup-upload.service` | rsync to Storage Box |

## Monitoring

The ops agent (`tools/ops/agent`) runs `scanTenantBackups()` every poll
(default 5 min). For any running tenant whose newest dump is >90 min old
it emits a `tenant_backup_stale` anomaly. Slack alert routes through the
normal dedup path (1/hr per service).

Quick manual check on the host:

```bash
ls -lht /opt/secondlayer/data/backups/tenants/*/ | head -20
systemctl list-timers 'secondlayer-*'
journalctl -u secondlayer-backup-tenant.service -n 50 --no-pager
```

## Restore

### 1. Locate the dump

From the host:
```bash
ls -lt /opt/secondlayer/data/backups/tenants/<slug>/
```

Or fetch from Storage Box:
```bash
rsync -avz -e "ssh -p ${STORAGEBOX_PORT}" \
  "${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${STORAGEBOX_PATH}/tenants/<slug>/2026-04-19T12-00-00Z.dump" \
  /tmp/
```

### 2. Restore into the tenant container

**Danger** — this overwrites the live tenant DB. Coordinate with the user
(and/or `sl instance suspend` first). `pg_restore --clean` drops and
recreates every object.

```bash
SLUG=<slug>
DUMP=/opt/secondlayer/data/backups/tenants/$SLUG/<timestamp>.dump

docker cp "$DUMP" sl-pg-$SLUG:/tmp/restore.dump
docker exec sl-pg-$SLUG pg_restore \
  -U secondlayer -d secondlayer \
  --clean --if-exists --no-owner --no-privileges \
  /tmp/restore.dump
docker exec sl-pg-$SLUG rm /tmp/restore.dump
```

### 3. Restore into a scratch DB first (recommended)

For point-in-time recovery or partial restores, spin up a scratch
container to inspect before overwriting prod.

```bash
docker run -d --rm --name pg-scratch \
  -e POSTGRES_USER=secondlayer \
  -e POSTGRES_PASSWORD=scratch \
  -e POSTGRES_DB=secondlayer \
  -p 5499:5432 postgres:16-alpine

docker cp "$DUMP" pg-scratch:/tmp/restore.dump
docker exec pg-scratch pg_restore -U secondlayer -d secondlayer \
  --clean --if-exists --no-owner /tmp/restore.dump

# inspect via psql -h localhost -p 5499 -U secondlayer
docker stop pg-scratch
```

### 4. Resume

```bash
sl instance resume   # if you suspended
```

## Recovery SLO

| Scenario | Expected recovery |
|---|---|
| Single-tenant restore from local disk | <5 min |
| Restore from Storage Box | <15 min (limited by rsync) |
| Full host loss → rehydrate from Storage Box | <1 hour (provision fresh tenant + restore) |

## Troubleshooting

**`pg_dump: error: connection to server ... failed`** — tenant container
is not accepting connections. Check `docker logs sl-pg-<slug>`. Backups
will retry next hour.

**Disk pressure warnings (>85%)** — run `backup-prune.sh` manually, or
shrink the local retention window (`HOURLY_KEEP_DAYS`, `DAILY_KEEP_DAYS`).
Storage Box retains separately and is the source of truth for anything
older than a few days on disk.

**Storage Box sync failures** — check the upload log:
`journalctl -u secondlayer-backup-upload.service -n 100`. Typical cause:
SSH key not authorized on the box.

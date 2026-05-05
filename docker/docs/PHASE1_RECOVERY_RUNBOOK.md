# Phase 1 Recovery Runbook

Phase 1 runs one live production server path. This runbook is for inspection, restart, rollback, backup verification, and non-destructive drill evidence. It intentionally avoids private hostnames, IP addresses, secrets, and raw URLs.

## Current Inventory

| Label | Role |
|---|---|
| `prod-live-1` | Current live application and data server. |
| `stacks-node-rpc` | Stacks node RPC dependency used by ingest. |
| `event-observer-target` | Chain event observer target that forwards events into Second Layer ingest. |
| `secondlayer-api` | Public HTTPS API for Stacks Streams, Stacks Index, status, and control-plane reads. |
| `secondlayer-indexer` | Ingest service that writes L1 and L2 stores. |
| `secondlayer-l2-decoder` | Continuous decoder service for Stacks Index freshness. |
| `secondlayer-worker` | Background worker for billing, usage, and maintenance jobs. |
| `secondlayer-postgres` | Primary Postgres data store. |

Deployment path: `/opt/secondlayer`.

Container orchestration: Docker Compose from `docker/docker-compose.hetzner.yml`.

Host deploy units:

- Transient deploy units named `secondlayer-deploy-<run_id>-<run_attempt>.service`.
- Static rollback unit if installed: `secondlayer-rollback.service`.

Backup mechanisms:

- Postgres logical/base backup scripts in `docker/scripts/`.
- WAL sync through `docker/scripts/sync-wal.sh` where configured.
- Daily `pg_dump` and deploy migrations share `$DATA_DIR/db-maintenance.lock` by default.
- The expected daily backup collision window is roughly `03:00-03:45 CEST`; deploy waits on `/opt/secondlayer/data/db-maintenance.lock` and must not interrupt an active backup.
- Snapshot upload and pruning through `secondlayer-backup-*` systemd timers.
- Current production may use root cron instead of systemd timers. Check both.

Expected backup freshness check: latest successful backup artifact and upload should be recent enough for the recovery point objective currently accepted by the operator. Record the observed timestamp in the drill log.

## Health Inspection

Run from an operator shell on `prod-live-1`.

```bash
cd /opt/secondlayer
docker compose -f docker/docker-compose.hetzner.yml ps
systemctl list-units --all 'secondlayer*' --no-pager
journalctl -u 'secondlayer-deploy-*' -n 80 --no-pager
```

Public checks:

```bash
curl --fail --silent --show-error https://api.secondlayer.tools/health
curl --fail --silent --show-error https://api.secondlayer.tools/public/status
```

Authenticated product checks:

```bash
curl --fail --silent --show-error --header "Authorization: Bearer $STREAMS_KEY" "https://api.secondlayer.tools/v1/streams/tip"
curl --fail --silent --show-error --header "Authorization: Bearer $STREAMS_KEY" "https://api.secondlayer.tools/v1/streams/events?limit=1"
curl --fail --silent --show-error --header "Authorization: Bearer $INDEX_KEY" "https://api.secondlayer.tools/v1/index/ft-transfers?limit=1"
```

## Service Restart

Restart the narrowest failing service first.

```bash
cd /opt/secondlayer
docker compose -f docker/docker-compose.hetzner.yml restart api
docker compose -f docker/docker-compose.hetzner.yml restart indexer
docker compose -f docker/docker-compose.hetzner.yml restart l2-decoder
docker compose -f docker/docker-compose.hetzner.yml restart worker
```

If Postgres is unhealthy, inspect logs before restart. Do not restart while backup or restore commands are running.

```bash
docker compose -f docker/docker-compose.hetzner.yml logs --tail=200 postgres
docker compose -f docker/docker-compose.hetzner.yml restart postgres
```

## Deploy Rollback

Use the host rollback script or the manual workflow that pins a previous image tag. Inspect the rollback unit after starting it.

```bash
cd /opt/secondlayer
./docker/scripts/rollback.sh
systemctl status secondlayer-rollback.service --no-pager
journalctl -u secondlayer-rollback.service -n 120 --no-pager
```

After rollback, run the post-recovery checklist below.

## Backup Verification

Inspect recent backup timer and service results.

```bash
systemctl list-timers 'secondlayer-backup-*' --no-pager
systemctl status secondlayer-backup-upload.service --no-pager
journalctl -u secondlayer-backup-upload.service -n 120 --no-pager
```

If timers are absent, inspect root cron.

```bash
crontab -l
```

Inspect local backup artifacts without printing credentials.

```bash
find /opt/secondlayer/data/backups -maxdepth 2 -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort | tail -20
tail -80 /opt/secondlayer/data/backups/backup-postgres.log
tail -80 /opt/secondlayer/data/backups/backup-basebackup.log
tail -80 /opt/secondlayer/data/backups/upload-snapshot.log
tail -80 /opt/secondlayer/data/backups/sync-wal.log
```

Run and verify one manual logical backup when closing a reliability gate.

```bash
DATA_DIR=/opt/secondlayer/data /opt/secondlayer/docker/scripts/backup-postgres.sh
gzip -t "$(find /opt/secondlayer/data/backups/postgres -name 'postgres-*.sql.gz' -type f -print | sort | tail -1)"
```

After WAL archiving is enabled, force one switch and sync the archive.

```bash
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT pg_switch_wal();"
DATA_DIR=/opt/secondlayer/data /opt/secondlayer/docker/scripts/sync-wal.sh
tail -20 /opt/secondlayer/data/backups/sync-wal.log
```

If object storage is configured, verify the latest remote object timestamp with the configured provider CLI. Do not paste credentials or signed URLs into the drill log.

## Log Inspection

```bash
cd /opt/secondlayer
docker compose -f docker/docker-compose.hetzner.yml logs --tail=200 api
docker compose -f docker/docker-compose.hetzner.yml logs --tail=200 indexer
docker compose -f docker/docker-compose.hetzner.yml logs --tail=200 l2-decoder
docker compose -f docker/docker-compose.hetzner.yml logs --tail=200 worker
```

Look for repeated 5xx responses, database connection failures, migration failures, decoder checkpoint stalls, and backup upload failures.

## Escalation Criteria

Escalate beyond restart or rollback when any of these are true:

- `/health` or `/public/status` remains unavailable after one targeted restart.
- Stacks Streams lag remains above the public threshold after ingest restart.
- Stacks Index decoder freshness remains unavailable after `l2-decoder` restart.
- Postgres logs show corruption, disk exhaustion, or failed recovery.
- Backup freshness cannot be verified.
- Rollback does not restore one Streams read and one Index read.

## Post-Recovery Checklist

- [ ] `/health` returns HTTP 200.
- [ ] `/public/status` returns HTTP 200 and includes `api`, `node`, `services`, `streams`, `index`, and `reorgs`.
- [ ] `/v1/streams/tip` returns a current tip with authenticated Stacks Streams key.
- [ ] `/v1/streams/events?limit=1` returns a valid Stacks Streams envelope with authenticated key.
- [ ] `/v1/index/ft-transfers?limit=1` returns a valid Stacks Index envelope with authenticated key.
- [ ] Post-recovery logs show no repeated restart loop.
- [ ] Backup freshness is recorded.

## Non-Destructive Drill Log Template

Copy this section into the sprint log or an ops note after Ryan runs the drill.

```md
### Phase 1 Recovery Drill

- Date/time:
- Operator:
- Environment: production, non-destructive
- Checklist used: docker/docs/PHASE1_RECOVERY_RUNBOOK.md
- Health inspection result:
- Backup freshness result:
- Service restart exercised: none / api / indexer / l2-decoder / worker
- Rollback exercised: no / yes, image tag:
- `/health` result:
- `/public/status` result:
- `/v1/streams/tip` result:
- Stacks Streams read result:
- Stacks Index read result:
- Manual intervention required:
- Follow-up items:
```

## Deferred Hot Spare

Hot-spare failover is not a Phase 1 gate. Future acceptance requires funded second server capacity, primary and spare inventory, operator-confirmed promotion, rollback steps, alerting that recommends promotion, and at least two rehearsals with recovery-time evidence.

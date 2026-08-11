# Secondlayer systemd units

Install the backup + health units on the production host.

## Units

| Unit | Purpose | Cadence |
|---|---|---|
| `secondlayer-backup-upload.{service,timer}` | rsync `$DATA_DIR/backups/` to Hetzner Storage Box | hourly at :45 (+ ≤5 min jitter) |
| `secondlayer-health-alert.{service,timer}` | curl `/public/status` + `docker compose ps` → Slack on failure (one alert per incident, all-clear on recovery) | every 5 min |
| `secondlayer-floor-audit.{service,timer}` | run `floor-audit.ts` in the decoder container → Slack if any decoder regressed below its genesis baseline or shipped unbaselined (one alert per incident, all-clear on recovery) | daily at 06:00 |
| `secondlayer-staging-health.{service,timer}` | run `scripts/ci/staging-health.ts` on the host → Slack on stale/misshapen tip data: service states, decoder lag bands, streams lag, dumps freshness, observer-journal failures/stalls, zero-timestamp blocks (one alert per incident, all-clear on recovery) | every 30 min |

The three health units answer different questions and none subsumes another:
`health-alert` is liveness (does the API answer, are containers up),
`staging-health` is freshness/shape at the TIP, `floor-audit` is completeness
down to GENESIS.

`staging-health` previously ran as a `*/30` cron in the `Staging Health` GitHub
workflow. Hosted runners were never assigned to most firings — the job sat
unassigned ~15 min and was cancelled with zero steps run, which paged red while
saying nothing about prod, and only ~4 of 48 daily firings materialized. That
workflow is now manual-dispatch only.

Each service sources `/opt/secondlayer/docker/.env` for `DATA_DIR`,
`STORAGEBOX_USER`, `STORAGEBOX_HOST`, `STORAGEBOX_PATH`, `STORAGEBOX_PORT`, and
`SLACK_WEBHOOK_URL` (health-alert + floor-audit + staging-health).
`staging-health` additionally builds a host-reachable SOURCE DB URL from
`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` (override the target with
`STAGING_HEALTH_DB_HOSTPORT`, default `127.0.0.1:5432`) and reads the optional
`STAGING_STATUS_API_KEY` to unlock the authorized `/status` checks. It probes
the indexer's `/health/integrity` at `STAGING_INDEXER_URL` (default
`http://127.0.0.1:3700`) and fails on disabled/unavailable/failed receipts or a
pending receipt older than `OBSERVER_JOURNAL_MAX_RECEIVED_SECONDS` (default
900 seconds).

## Install

```bash
sudo cp /opt/secondlayer/docker/systemd/*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
  secondlayer-backup-upload.timer \
  secondlayer-health-alert.timer \
  secondlayer-floor-audit.timer \
  secondlayer-staging-health.timer
```

## Verify

```bash
systemctl list-timers 'secondlayer-*'
journalctl -u secondlayer-health-alert.service -n 50 --no-pager
journalctl -u secondlayer-floor-audit.service -n 50 --no-pager
tail -n 50 /var/log/secondlayer-staging-health.log
ls -lh /opt/secondlayer/data/backups/
```

## Manual trigger (test)

```bash
sudo systemctl start secondlayer-backup-upload.service
sudo systemctl start secondlayer-health-alert.service
sudo systemctl start secondlayer-floor-audit.service
sudo systemctl start secondlayer-staging-health.service
```

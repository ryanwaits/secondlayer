# Secondlayer systemd units

Install the tenant backup pipeline on the production host.

## Units

| Unit | Purpose | Cadence |
|---|---|---|
| `secondlayer-backup-tenant.{service,timer}` | `pg_dump` every running `sl-pg-<slug>` container to `$DATA_DIR/backups/tenants/<slug>/*.dump` | hourly (on the hour + ≤5 min jitter) |
| `secondlayer-backup-prune.{service,timer}` | Enforce retention — hourly dumps for 7d, first-of-day for 30d | hourly at :30 |
| `secondlayer-backup-upload.{service,timer}` | rsync `$DATA_DIR/backups/` to Hetzner Storage Box | hourly at :45 (+ ≤5 min jitter) |

Each service sources `/opt/secondlayer/docker/.env` for `DATA_DIR`,
`STORAGEBOX_USER`, `STORAGEBOX_HOST`, `STORAGEBOX_PATH`, `STORAGEBOX_PORT`.

## Install

```bash
sudo cp /opt/secondlayer/docker/systemd/*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
  secondlayer-backup-tenant.timer \
  secondlayer-backup-prune.timer \
  secondlayer-backup-upload.timer
```

## Verify

```bash
systemctl list-timers 'secondlayer-*'
journalctl -u secondlayer-backup-tenant.service -n 50 --no-pager
ls -lh /opt/secondlayer/data/backups/tenants/
```

## Manual trigger (test)

```bash
sudo systemctl start secondlayer-backup-tenant.service
sudo systemctl start secondlayer-backup-prune.service
sudo systemctl start secondlayer-backup-upload.service
```

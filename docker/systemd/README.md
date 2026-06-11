# Secondlayer systemd units

Install the backup + health units on the production host.

## Units

| Unit | Purpose | Cadence |
|---|---|---|
| `secondlayer-backup-upload.{service,timer}` | rsync `$DATA_DIR/backups/` to Hetzner Storage Box | hourly at :45 (+ ≤5 min jitter) |
| `secondlayer-health-alert.{service,timer}` | curl `/public/status` + `docker compose ps` → Slack on failure (one alert per incident, all-clear on recovery) | every 5 min |

Each service sources `/opt/secondlayer/docker/.env` for `DATA_DIR`,
`STORAGEBOX_USER`, `STORAGEBOX_HOST`, `STORAGEBOX_PATH`, `STORAGEBOX_PORT`.

## Install

```bash
sudo cp /opt/secondlayer/docker/systemd/*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
  secondlayer-backup-upload.timer \
  secondlayer-health-alert.timer
```

## Verify

```bash
systemctl list-timers 'secondlayer-*'
journalctl -u secondlayer-health-alert.service -n 50 --no-pager
ls -lh /opt/secondlayer/data/backups/
```

## Manual trigger (test)

```bash
sudo systemctl start secondlayer-backup-upload.service
sudo systemctl start secondlayer-health-alert.service
```

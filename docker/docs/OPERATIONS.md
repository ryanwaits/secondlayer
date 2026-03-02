# Operations Guide

Day-to-day commands for managing a Second Layer deployment. Run from `/opt/secondlayer/docker`.

## Quick Reference

```bash
# Hetzner alias — use this for ALL compose commands
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
```

> **WARNING**: Always use both compose files on Hetzner. Never run plain `docker compose up` — it creates a fresh named volume instead of using the bind-mounted data at `/opt/secondlayer/data/postgres`, effectively hiding your database.
>
> ```bash
> # CORRECT:
> $COMPOSE up -d --build
>
> # WRONG — will create empty volume, lose access to data:
> docker compose up -d --build
> ```

---

## Logs

```bash
# All services
$COMPOSE logs --tail 50

# Single service (api, indexer, worker, stacks-node, postgres, caddy)
$COMPOSE logs indexer --tail 50
$COMPOSE logs stacks-node --tail 50

# Follow in real time
$COMPOSE logs -f worker

# Since a specific time
$COMPOSE logs --since 30m indexer

# Watch stacks-node logs
$COMPOSE logs -f stacks-node
```

---

## Service Status & Health

```bash
# All services + health
$COMPOSE ps

# Resource usage per container
docker stats --no-stream

# Indexer health + block progress
curl -s http://localhost:3700/health | jq
curl -s http://localhost:3700/health/integrity | jq

# API health
curl -s http://localhost:3800/health | jq

# API status (queue depth, block tip, gaps)
curl -s http://localhost:3800/status | jq

# Stacks node sync progress
curl -s http://localhost:20443/v2/info | jq '{burn_block_height, stacks_tip_height, stacks_tip}'

# PoX / reward cycle
curl -s http://localhost:20443/v2/pox | jq '{current_cycle, reward_cycle_length, current_burnchain_block_height}'

# Peer connectivity
curl -s http://localhost:20443/v2/neighbors | jq '{inbound: (.inbound | length), outbound: (.outbound | length)}'

# Compare node vs indexer tip
echo "node:" && curl -s localhost:20443/v2/info | jq .stacks_tip_height && \
echo "indexer:" && curl -s localhost:3700/health | jq .lastSeenHeight

# Continuous monitoring
watch -n 30 'curl -s localhost:20443/v2/info | jq "{stacks_tip_height, burn_block_height}" && curl -s localhost:3700/health | jq "{indexer_tip: .lastSeenHeight}"'
```

### Check for Missing Blocks

```bash
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT count(*) as total_blocks FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT min(height), max(height) FROM blocks;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT (max(height) - min(height) + 1) - count(*) as missing FROM blocks WHERE canonical = true;"
```

### Service Health

```bash
# API
curl -s localhost:3800/health | jq .

# Indexer
curl -s localhost:3700/health | jq .

# Postgres connections & DB size
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT count(*) as active_connections FROM pg_stat_activity;"
docker exec secondlayer-postgres-1 psql -U secondlayer -c "SELECT pg_size_pretty(pg_database_size('secondlayer')) as db_size;"

# Check event dispatcher (should return empty when healthy)
docker logs --tail 50 secondlayer-stacks-node-1 2>&1 | grep "event_dispatcher"
```

---

## Restart Services

```bash
# Single service
$COMPOSE restart worker
$COMPOSE restart indexer
$COMPOSE restart stacks-node

# Restart everything
$COMPOSE restart

# Full stop + start (recreates containers)
$COMPOSE down && $COMPOSE up -d
```

---

## Update / Upgrade

### Full Stack Update (with rebuild)

```bash
cd /opt/secondlayer
git pull
cd docker
$COMPOSE down
$COMPOSE up -d --build
```

### Individual Service Updates

```bash
# API only
$COMPOSE up -d --build api

# Indexer only
$COMPOSE up -d --build indexer

# Worker only (can scale at same time)
$COMPOSE up -d --build --scale worker=3 worker

# View processor only
$COMPOSE up -d --build view-processor

# Stacks node only (pulls latest image)
$COMPOSE pull stacks-node && $COMPOSE up -d stacks-node
```

> **Note**: Keep the stacks-node compose image version aligned with Hiro archive snapshot versions when restoring from snapshots.

### Quick Update (config/env only, no rebuild)

```bash
$COMPOSE up -d --force-recreate api
```

### Zero-Downtime Updates

```bash
# Scale up first, then scale back down
$COMPOSE up -d --scale worker=4 --no-recreate
$COMPOSE up -d --build worker
$COMPOSE up -d --scale worker=2
```

### Apply Config Changes

After editing `docker/.env` or `docker-compose.yml`:

```bash
# Recreate affected containers
$COMPOSE up -d

# Or force recreate all
$COMPOSE up -d --force-recreate
```

### Verify After Update

```bash
$COMPOSE ps
$COMPOSE logs --tail 20
curl -s http://localhost:3800/health | jq
curl -s http://localhost:3700/health | jq
```

### Platform-Specific Upgrade

**Hetzner:**
```bash
cd /opt/secondlayer && git pull
cd docker
$COMPOSE up -d --build
```

**Docker Compose (non-Hetzner):**
```bash
git pull
docker compose build
docker compose up -d
```

**Render:** Push to connected branch. Render auto-deploys. Migrations run on API startup.

---

## Scaling Workers

Workers can be horizontally scaled. Each worker claims jobs using PostgreSQL's `SKIP LOCKED` to prevent duplicates.

```bash
# Hetzner
$COMPOSE up -d --scale worker=3

# Docker Compose (non-Hetzner)
docker compose up -d --scale worker=3
```

Render: Deploy multiple worker instances.

---

## Database

```bash
# Connect to psql
docker exec -it secondlayer-postgres-1 psql -U secondlayer -d secondlayer

# Check block count
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT COUNT(*) FROM blocks;"

# Quick backup
docker exec secondlayer-postgres-1 pg_dump -U secondlayer secondlayer > backup-$(date +%F).sql
```

---

## Backups

### Automated Cron Setup

```bash
# Add to root crontab
crontab -e

# Postgres backup — daily at 3am
0 3 * * * /opt/secondlayer/docker/scripts/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1

# Chainstate backup (LVM snapshot) — daily at 4am
0 4 * * * /opt/secondlayer/docker/scripts/backup-chainstate.sh >> /var/log/backup-chainstate.log 2>&1
```

### Hiro Postgres Backup

```bash
# Manual
/opt/secondlayer/docker/scripts/backup-hiro-postgres.sh

# Cron (3:30 AM daily, after main postgres backup)
30 3 * * * /opt/secondlayer/docker/scripts/backup-hiro-postgres.sh >> /var/log/backup-hiro-postgres.log 2>&1
```

### Offsite Upload (Storage Box)

```bash
# Manual
/opt/secondlayer/docker/scripts/upload-snapshot.sh

# Dry run (show what would transfer)
/opt/secondlayer/docker/scripts/upload-snapshot.sh --dry-run

# Cron (5 AM daily, after backups complete)
0 5 * * * /opt/secondlayer/docker/scripts/upload-snapshot.sh >> /var/log/upload-snapshot.log 2>&1

# Verify files on Storage Box
ssh -p 23 $STORAGEBOX_USER@$STORAGEBOX_HOST ls -lh /backups/postgres/
ssh -p 23 $STORAGEBOX_USER@$STORAGEBOX_HOST ls -lh /backups/hiro-postgres/
```

### Restore from Snapshot

```bash
# Verify current DB integrity (no changes)
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --verify-only
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --hiro --verify-only

# Dry run (show steps without executing)
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --dry-run
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --hiro --date 20260301 --dry-run

# Restore latest backup
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh

# Restore specific date (hiro)
/opt/secondlayer/docker/scripts/restore-from-snapshot.sh --hiro --date 20260301
```

### Pre-upgrade Snapshot

```bash
# Run before any upgrade — backs up both DBs + uploads to Storage Box
/opt/secondlayer/docker/scripts/pre-upgrade-snapshot.sh
```

### Recommended Cron Schedule

```bash
0 3  * * * /opt/secondlayer/docker/scripts/backup-postgres.sh >> /var/log/backup-postgres.log 2>&1
30 3 * * * /opt/secondlayer/docker/scripts/backup-hiro-postgres.sh >> /var/log/backup-hiro-postgres.log 2>&1
0 4  * * * /opt/secondlayer/docker/scripts/backup-chainstate.sh >> /var/log/backup-chainstate.log 2>&1
0 5  * * * /opt/secondlayer/docker/scripts/upload-snapshot.sh >> /var/log/upload-snapshot.log 2>&1
```

### Manual pg_dump / Restore

```bash
# Dump
docker exec secondlayer-postgres-1 pg_dump -U secondlayer secondlayer > backup-$(date +%F).sql

# Restore
cat backup.sql | docker exec -i secondlayer-postgres-1 psql -U secondlayer -d secondlayer
```

### PostgreSQL Tuning for Fast Restore

Temporarily adjust settings during large restores:

```sql
-- Before restore
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET max_wal_size = '64GB';
ALTER SYSTEM SET checkpoint_timeout = '3600';
ALTER SYSTEM SET autovacuum = off;
SELECT pg_reload_conf();

-- After restore
ALTER SYSTEM RESET maintenance_work_mem;
ALTER SYSTEM RESET max_wal_size;
ALTER SYSTEM RESET checkpoint_timeout;
ALTER SYSTEM SET autovacuum = on;
SELECT pg_reload_conf();
VACUUM ANALYZE;
```

---

## Disk Usage

```bash
# Overall disk
df -h /opt/secondlayer

# Per-directory breakdown
du -sh /opt/secondlayer/data/postgres
du -sh /opt/secondlayer/data/stacks-blockchain
du -sh /mnt/chainstate  # if using separate mount

# Docker volumes
docker system df
```

---

## Monitoring

Key metrics to monitor:

| Metric | How |
|--------|-----|
| Queue depth | `GET /status` → pending job count |
| Delivery success rate | Track `failedDeliveries` in stream metrics |
| Indexer lag | Compare `lastIndexedBlock` to chain tip |
| Block integrity | `GET /status` → `integrity`, `gaps`, `totalMissingBlocks` |
| Integrity health | `GET /health/integrity` on indexer |
| Out-of-order blocks | `GET /health` and `GET /status` include counter |

---

## Troubleshooting

### Indexer Not Receiving Blocks

1. Check Stacks node logs for event observer errors
2. Verify network connectivity between node and indexer
3. Ensure `events_keys = ["*"]` in `Config.toml`

### Node Stuck on "missing PoX anchor block"

Symptom: logs loop with `Currently missing PoX anchor block` and `Burnchain block processing stops`.

1. Upgrade to latest stacks-node version ([releases](https://github.com/stacks-network/stacks-core/releases))
2. Restart: `$COMPOSE restart stacks-node`

### Event Dispatcher Stuck ("Failed to send socket data")

Symptom: `Event dispatcher: connection or request failed to indexer:3700` repeating.

1. Stop stacks-node
2. Delete pending payloads DB: `rm /opt/secondlayer/data/stacks-blockchain/event_observers.sqlite`
3. Restart stacks-node
4. Check for block gaps (see "Check for Missing Blocks" above)

### Webhooks Not Delivering

1. Check `streams logs <stream-id>` for delivery errors
2. Verify webhook URL is reachable from worker
3. Check for signature verification failures

### High Queue Depth

1. Scale up workers
2. Check for slow webhook endpoints (increase timeout or optimize)
3. Check worker logs for errors

---

## Agent (AI DevOps Monitoring)

The agent monitors all services, auto-fixes safe issues, and alerts on dangerous ones via Slack.

### Status & Health

```bash
# Agent health
curl -s http://localhost:3900/health | jq

# Agent logs
$COMPOSE logs agent --tail 50
$COMPOSE logs -f agent
```

### Query Decision History

```bash
# Recent decisions
docker exec secondlayer-agent sqlite3 /data/agent/agent.db "SELECT * FROM decisions ORDER BY id DESC LIMIT 10;"

# Today's AI spend
docker exec secondlayer-agent sqlite3 /data/agent/agent.db "SELECT SUM(cost_usd) FROM decisions WHERE created_at > datetime('now', '-1 day');"

# Active alerts
docker exec secondlayer-agent sqlite3 /data/agent/agent.db "SELECT * FROM alerts WHERE resolved_at IS NULL;"
```

### Manual Slack Test

```bash
# Send test message (requires SLACK_WEBHOOK_URL in .env)
curl -X POST "$SLACK_WEBHOOK_URL" -H 'Content-Type: application/json' -d '{"text":"Agent test message"}'
```

### Restart Agent

```bash
$COMPOSE restart agent
```

### Disable AI (kill switch)

```bash
# In .env
AGENT_AI_ENABLED=false

# Apply
$COMPOSE up -d agent
```

### Dry Run Mode

```bash
# In .env
AGENT_DRY_RUN=true

# Apply — agent logs actions without executing
$COMPOSE up -d agent
```

### Slack App Setup (Thread Replies + Buttons)

The agent supports two Slack modes:

- **Webhook-only** (v1): set `SLACK_WEBHOOK_URL`. Simple top-level messages.
- **API mode** (v2): set `SLACK_API_TOKEN` + `SLACK_CHANNEL_ID`. Enables thread grouping, auto-resolve, and action buttons.

#### Setup Steps

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From Scratch
2. **OAuth & Permissions** → Add Bot Token Scopes: `chat:write`, `chat:update`
3. Install to Workspace → Copy **Bot User OAuth Token** (`xoxb-...`)
4. Get channel ID: right-click `#secondlayer-alerts` → View Channel Details → copy ID at bottom
5. Set env vars:
   ```bash
   SLACK_API_TOKEN=xoxb-...
   SLACK_CHANNEL_ID=C0XXXXXXXXX
   ```
6. Invite bot to channel: `/invite @YourBotName` in `#secondlayer-alerts`
7. Deploy: `$COMPOSE up -d --build agent`

#### Enable Buttons (Interactivity)

1. In Slack app settings → **Interactivity & Shortcuts** → Toggle ON
2. Set Request URL: `https://<your-domain>/hooks/slack`
3. Copy **Signing Secret** from Basic Information page
4. Set env var:
   ```bash
   SLACK_SIGNING_SECRET=<signing-secret>
   ```
5. Deploy: `$COMPOSE up -d --build agent`

#### Button Behavior

| Button | Action |
|--------|--------|
| Restart | Restarts the service via Docker Compose |
| Investigate | Runs Sonnet AI diagnosis, posts findings in thread |
| Verify | Runs health check, posts results in thread |
| Dismiss | Resolves alert, removes buttons from message |
| Execute Suggested | Executes AI-suggested action |

#### Auto-Resolve

When a service recovers (next poll shows healthy), the agent automatically:
- Resolves the alert in DB
- Posts recovery message in the alert thread

#### Env Vars

| Var | Required | Description |
|-----|----------|-------------|
| `SLACK_WEBHOOK_URL` | No | Webhook URL (fallback mode) |
| `SLACK_API_TOKEN` | No | Bot token for API mode (`xoxb-...`) |
| `SLACK_CHANNEL_ID` | No | Channel ID for API mode |
| `SLACK_SIGNING_SECRET` | No | For verifying button callbacks |

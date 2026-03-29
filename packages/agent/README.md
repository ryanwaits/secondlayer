# @secondlayer/agent

Autonomous AI DevOps monitoring agent for a Stacks blockchain indexing deployment on Hetzner AX52. Watches Docker container logs in real-time, polls service health every 5 minutes, auto-fixes known issues, and escalates unknowns to AI for diagnosis. All decisions are logged to SQLite. Alerts go to Slack.

---

## Architecture

```
                           HETZNER AX52
  +----------------------------------------------------------+
  |                                                          |
  |   DOCKER CONTAINERS              AGENT (port 3900)      |
  |   ==================            ===================      |
  |                                                          |
  |   indexer -------+               +------------------+    |
  |   api -----------+  docker logs  |                  |    |
  |   worker --------+  --follow     |   Log Watcher    |    |
  |   subgraph-processor+  -------->  |   (6 services)   |    |
  |   postgres ------+               |                  |    |
  |                                  +--------+---------+    |
  |   caddy ---------+                  Pattern Match        |
  |                                        |                 |
  |   stacks-node                          v                 |
  |       |                     +----------+----------+      |
  |       | RPC /v2/info        |                     |      |
  |       +-------------------> | Health Poller (5m)  |      |
  |                             |                     |      |
  |   Endpoints polled:         +----------+----------+      |
  |   - indexer:3700/health                |                 |
  |   - api:3800/health                    v                 |
  |   - stacks-node:20443/v2/info  +-------+--------+       |
  |   - indexer:3700/health/       | Anomaly Detect  |       |
  |     integrity                  +-------+--------+        |
  |                                        |                 |
  +----------------------------------------+-----------------+
                                           |
                              +------------+------------+
                              |                         |
                         Known Pattern            Unknown/Escalate
                              |                         |
                              v                         v
                     +--------+--------+      +---------+---------+
                     | Action Executor |      |  60s Batch Window  |
                     | (restart, prune,|      +--------+----------+
                     |  vacuum, etc.)  |               |
                     +--------+--------+               v
                              |               +--------+---------+
                              |               |  Haiku Analysis   |
                              |               | (Zod-validated)   |
                              |               +--------+---------+
                              |                        |
                              |           +------------+------------+
                              |           |                         |
                              |     >70% confidence          <50% + severe
                              |     + safe action                   |
                              |           |                         v
                              |           v               +---------+---------+
                              |    Auto-execute           |  Sonnet Escalation |
                              |           |               |  (Bash/Read/Grep   |
                              |           |               |   w/ allowlist)    |
                              |           |               +---------+---------+
                              |           |                         |
                              +-----+-----+-------+---------+------+
                                    |             |          |
                                    v             v          v
                              +-----------+  +--------+  +--------+
                              |  SQLite   |  | Slack  |  | Stdout |
                              |  (all     |  | Alerts |  |  Logs  |
                              | decisions)|  +--------+  +--------+
                              +-----------+
```

**stacks-node is monitored via RPC polling only** -- its log output is too verbose for real-time tailing.

---

## What's Monitored

### Real-Time Log Watching (6 services)

| Service | Container | Health URL | Auto-Restart |
|---|---|---|---|
| indexer | secondlayer-indexer-1 | `localhost:3700/health` | Yes |
| api | secondlayer-api-1 | `localhost:3800/health` | Yes |
| worker | secondlayer-worker-1 | -- | Yes |
| subgraph-processor | secondlayer-subgraph-processor-1 | -- | Yes |
| postgres | secondlayer-postgres-1 | -- | No |
| caddy | secondlayer-caddy-1 | -- | Yes |
| **stacks-node** | **secondlayer-stacks-node-1** | **RPC only** | **Never** |

### Pattern Rules

| Pattern | Regex | Severity | Action | Scoped To |
|---|---|---|---|---|
| `oom_kill` | `Out of memory\|OOM\|oom-kill\|Killed process` | critical | `restart_service` | all |
| `disk_full` | `No space left on device\|ENOSPC\|disk full` | critical | `prune_docker` | all |
| `conn_refused` | `ECONNREFUSED\|Connection refused` | warn | `restart_service` | all |
| `pg_fatal` | `FATAL\|PANIC: (.+)` | critical | `alert_only` | postgres |
| `gap_growth` | `gap\|missing .+ blocks?\|gaps?` | warn | `alert_only` | indexer |
| `sync_stall` | `stall\|stuck\|timeout .+ sync\|block\|chain` | warn | `restart_service` | indexer |
| `unhandled_error` | `unhandled\|uncaught .+ error\|exception\|rejection` | error | `escalate` (AI) | all |
| `backup_failed` | `backup\|pg_dump\|rsync .+ failed\|error\|FATAL` | error | `alert_only` | all |

### Health Polling (every 5 minutes)

Each poll cycle hits these endpoints and collects system metrics:

```
GET  http://indexer:3700/health              → block height, service status
GET  http://api:3800/health                  → service status
GET  http://stacks-node:20443/v2/info        → chain tip height, burn height
GET  http://indexer:3700/health/integrity     → gap count, total missing blocks
```

Plus system-level collection:
- **Disk usage** via `df -B1 /`
- **Memory usage** via `free -b`
- **Container stats** via `docker stats --no-stream` + `docker inspect` (restart counts)

### Anomaly Detection (consecutive poll comparison)

| Anomaly | Threshold | Severity | Action |
|---|---|---|---|
| `disk_high` | >85% (>95% = critical) | warn/critical | `prune_docker` |
| `no_new_blocks` | Same height across 2 polls (~5 min) | warn | `alert_only` |
| `gap_increase` | `totalMissing` grew since last poll | warn | `alert_only` |
| `restart_loop` | Container restart count >3 | error | `alert_only` |
| `chain_tip_lag` | Indexer >10 blocks behind stacks-node | warn | `alert_only` |
| `service_down` | Health check failed (indexer or api) | error | `restart_service` |

---

## Safety Rules

### Restart Classification

```
SAFE_RESTART:    indexer, api, worker, subgraph-processor, caddy
NEVER_RESTART:   stacks-node
WARN_RESTART:    postgres  (alert only, no auto-restart)
```

### Guardrails

- **Cooldown**: Max 3 restarts per hour per service. Tracked in SQLite `cooldowns` table.
- **NEVER_RESTART**: Any restart attempt on `stacks-node` is blocked and logged.
- **WARN_RESTART**: Restart requests for `postgres` are downgraded to `alert_only`.
- **Budget cap**: $5/day default for AI API spend. When exceeded, AI analysis is skipped and a budget alert is sent.
- **Dry run mode**: All actions are logged but not executed.

---

## AI Analysis Pipeline

```
  Unhandled/unknown errors
           |
           v
  +------------------+
  | 60-second batch  |   (collect multiple pattern matches into one call)
  +--------+---------+
           |
           v
  +--------+---------+
  |  Haiku Analysis  |   claude-haiku-4-5-20251001
  |  (Zod-validated) |   max_tokens: 500
  +--------+---------+
           |
     +-----+-----+
     |           |
  >70%        <50%
  confidence  confidence
  + safe      + severity >= warn
  action          |
     |            v
     v     +------+--------+
  Auto-    | Sonnet Escal. |   claude-sonnet-4-6
  execute  | (Agent SDK)   |   maxTurns: 5
           | Tools: Bash,  |   Bash commands allowlisted:
           |  Read, Grep   |   - docker logs/stats/inspect/ps
           +------+--------+   - curl -s http://localhost...
                  |            - df, free
                  v            - docker exec ... psql -c "SELECT..."
           Alert + diagnosis
```

### Flow Details

1. Unknown or unhandled errors are collected in a 60-second batch window to avoid redundant API calls.
2. **Haiku** receives the batch with full system context (health status, recent decisions, latest snapshot).
3. Haiku's JSON response is validated against a Zod schema: `{ severity, diagnosis, suggestedAction, confidence }`.
4. If confidence >70% and the suggested action is safe: auto-execute.
5. If confidence <50% and severity is `warn`, `error`, or `critical`: escalate to **Sonnet**.
6. Sonnet runs as a Claude Agent SDK session with tool access (Bash, Read, Grep). Bash commands are filtered through an allowlist.
7. All decisions are logged with `tier` (`t2_haiku` or `t3_sonnet`), cost, and outcome.

### Cost Tracking

| Model | Input $/1K tokens | Output $/1K tokens |
|---|---|---|
| Haiku | $0.00025 | $0.00125 |
| Sonnet | $0.003 | $0.015 |

Token usage is tracked per call. Daily spend is summed from the `decisions` table and checked before every AI call.

---

## Management Commands

```bash
# Compose alias
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# Agent health
docker exec secondlayer-agent curl -s http://localhost:3900/health | jq

# Agent logs
$COMPOSE logs agent --tail 50

# Query recent decisions
docker exec secondlayer-agent sqlite3 /data/agent/agent.db \
  "SELECT * FROM decisions ORDER BY id DESC LIMIT 10;"

# Today's AI spend
docker exec secondlayer-agent sqlite3 /data/agent/agent.db \
  "SELECT SUM(cost_usd) FROM decisions WHERE created_at > datetime('now', '-1 day');"

# Active (unresolved) alerts
docker exec secondlayer-agent sqlite3 /data/agent/agent.db \
  "SELECT * FROM alerts WHERE resolved_at IS NULL;"

# Restart the agent
$COMPOSE restart agent

# Disable AI (kill switch)
# Set in .env:  AGENT_AI_ENABLED=false
$COMPOSE up -d agent

# Enable dry run (no real actions, only logging)
# Set in .env:  AGENT_DRY_RUN=true
$COMPOSE up -d agent
```

### Health Endpoint Response

```
GET http://localhost:3900/health
```

```json
{
  "status": "healthy",
  "uptime": 86400,
  "watchersConnected": 6,
  "watchersTotal": 6,
  "lastPollAt": 1709312400000,
  "decisionsToday": 3,
  "aiSpendToday": 0.0042
}
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `SLACK_WEBHOOK_URL` | `""` | Slack incoming webhook URL for alerts |
| `ANTHROPIC_API_KEY` | `""` | Anthropic API key for Haiku/Sonnet |
| `AGENT_DRY_RUN` | `false` | Log actions without executing |
| `AGENT_AI_ENABLED` | `true` | Enable/disable AI analysis pipeline |
| `AGENT_POLL_INTERVAL_MS` | `300000` (5 min) | Health poll interval |
| `AGENT_BUDGET_CAP_DAILY_USD` | `5` | Max daily AI API spend |
| `AGENT_MAX_RESTARTS_PER_HOUR` | `3` | Restart cooldown per service |
| `AGENT_DATA_DIR` | `/data/agent` | Directory for SQLite DB and data |
| `AGENT_DB_PATH` | `$AGENT_DATA_DIR/agent.db` | SQLite database path |
| `COMPOSE_DIR` | `/opt/secondlayer/docker` | Docker compose project directory |
| `COMPOSE_CMD` | `docker compose -f ...` | Full compose command (auto-derived from `COMPOSE_DIR`) |
| `INDEXER_URL` | `http://indexer:3700` | Indexer service URL |
| `API_URL` | `http://api:3800` | API service URL |
| `STACKS_NODE_URL` | `http://stacks-node:20443` | Stacks node RPC URL |

---

## Database Schema (SQLite)

Four tables. WAL mode enabled. Busy timeout 5000ms. Records older than 30 days are pruned daily.

### `decisions`

Every action the agent takes or considers, with AI cost tracking.

```sql
CREATE TABLE decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tier          TEXT NOT NULL,          -- t1_auto | t2_haiku | t3_sonnet | t4_human
  trigger_text  TEXT NOT NULL,          -- pattern name(s) that triggered this
  analysis      TEXT NOT NULL,          -- human-readable diagnosis
  action        TEXT NOT NULL,          -- restart_service | prune_docker | alert_only | ...
  service       TEXT NOT NULL,          -- which service
  outcome       TEXT NOT NULL DEFAULT '',  -- success | failed | blocked | cooldown | dry_run
  cost_usd      REAL NOT NULL DEFAULT 0,  -- AI API cost for this decision
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `snapshots`

Point-in-time system state captured every poll cycle.

```sql
CREATE TABLE snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  disk        TEXT NOT NULL DEFAULT '{}',    -- { usedPct, availBytes }
  mem         TEXT NOT NULL DEFAULT '{}',    -- { usedPct, availBytes }
  gaps        TEXT NOT NULL DEFAULT '{}',    -- total missing blocks
  tips        TEXT NOT NULL DEFAULT '{}',    -- { indexer, stacksNode } heights
  services    TEXT NOT NULL DEFAULT '{}',    -- { service: "healthy"|"unhealthy" }
  queue       TEXT NOT NULL DEFAULT '{}',    -- pending work items
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `alerts`

All alerts, with optional resolution tracking.

```sql
CREATE TABLE alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  severity     TEXT NOT NULL,      -- info | warn | error | critical
  service      TEXT NOT NULL,
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  slack_ts     TEXT,               -- Slack message timestamp (for threading)
  resolved_at  TEXT,               -- NULL if still active
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `cooldowns`

Rate-limiting tracker for automated restarts.

```sql
CREATE TABLE cooldowns (
  service           TEXT NOT NULL,
  action            TEXT NOT NULL,
  last_executed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  count_last_hour   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (service, action)
);
```

---

## Slack Alert Format

Alerts are sent as Block Kit messages with severity-coded headers:

```
+--------------------------------------------------+
| :information_source: [info] Indexer Sync Complete |
+--------------------------------------------------+
| Service:  indexer     | Severity:  info           |
+--------------------------------------------------+
| Details:                                          |
| Indexer caught up to chain tip at height 182345   |
+--------------------------------------------------+

+--------------------------------------------------+
| :warning: [warn] Chain Tip Lag                    |
+--------------------------------------------------+
| Service:  indexer     | Severity:  warn           |
+--------------------------------------------------+
| Details:                                          |
| Indexer lagging 12 blocks behind stacks-node      |
+--------------------------------------------------+

+--------------------------------------------------+
| :x: [error] Service Down                         |
+--------------------------------------------------+
| Service:  api        | Severity:  error           |
+--------------------------------------------------+
| Details:                                          |
| API health check failed: ECONNREFUSED             |
+--------------------------------------------------+
| Action:  restart_service  | Outcome:  success     |
+--------------------------------------------------+

+--------------------------------------------------+
| :rotating_light: [critical] OOM Kill              |
+--------------------------------------------------+
| Service:  worker     | Severity:  critical        |
+--------------------------------------------------+
| Details:                                          |
| OOM kill detected in worker                       |
+--------------------------------------------------+
| Action:  restart_service  | Outcome:  success     |
+--------------------------------------------------+
```

AI-driven alerts include a confidence percentage and are prefixed with `[AI]` or `[Sonnet]`:

```
+--------------------------------------------------+
| :warning: [AI] unhandled_error                    |
+--------------------------------------------------+
| Service:  indexer     | Severity:  warn           |
+--------------------------------------------------+
| Details:                                          |
| Memory pressure causing sporadic failures.        |
| Indexer process heap nearing container limit.      |
|                                                   |
| Confidence: 82%                                   |
+--------------------------------------------------+
| Action:  restart_service  | Outcome:  success     |
+--------------------------------------------------+
```

### Daily Summary (5:00 UTC)

```
+--------------------------------------------------+
| :chart_with_upwards_trend: Daily Summary          |
+--------------------------------------------------+
| Services:  6/7 healthy  | Actions Today:  4      |
| AI Spend:  $0.0042      | Gaps:  0               |
+--------------------------------------------------+
```

---

## Decision Tiers

| Tier | Label | Description |
|---|---|---|
| `t1_auto` | Auto | Known pattern matched, action executed directly |
| `t2_haiku` | Haiku | Unknown error analyzed by Haiku |
| `t3_sonnet` | Sonnet | Low-confidence escalation with tool use |
| `t4_human` | Human | Reserved for manual intervention flags |

---

## Tech Stack

- **Runtime**: Bun
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`) + Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Validation**: Zod v4
- **Database**: SQLite via `bun:sqlite` (WAL mode)
- **Notifications**: Slack Block Kit via incoming webhooks
- **Log tailing**: `docker logs --follow` spawned as child processes with auto-reconnect

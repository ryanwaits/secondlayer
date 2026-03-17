# Snapshots Roadmap

> **Status: Planning** — not yet implemented. See [docker/docs/OPERATIONS.md](docs/OPERATIONS.md) for current backup procedures.

How indexer snapshots will improve the experience for Second Layer operators and clients.

---

## The Problem

**Without snapshots:**
- New deployments require syncing from block 0 → days/weeks
- Historical backfill for streams processes blocks sequentially → slow
- View reindexing re-fetches every block from the node → slow
- Disaster recovery means full resync → extended downtime
- Clients can't easily self-host or access historical data

---

## User Stories

### Internal Operations

#### Disaster Recovery
> "Our production database crashed. We need to restore service ASAP."

| Without Snapshot | With Snapshot |
|------------------|---------------|
| Resync from block 0 | Restore latest snapshot |
| Days to weeks | Hours |

#### New Region Deployment
Restore snapshot to new region, catch up a few hundred blocks, route traffic. Online same day.

#### Staging & Testing
Restore yesterday's snapshot to staging. Realistic test data without impacting production.

#### Debugging
Restore snapshot locally, replay specific block range, step through handler logic.

---

### Client-Facing

#### New Stream with Historical Data
**With snapshot-powered backfill:**
```
1. Create stream via API
2. GET /streams/{id}/history?from=170000
3. Receive paginated JSON immediately
4. New blocks delivered in real-time
```

#### Self-Hosted Indexer
```bash
curl -LO https://snapshots.secondlayer.tools/mainnet/latest.tar.zst
pg_restore -j8 -d $DATABASE_URL snapshot/
docker compose up -d
# Running in hours
```

#### Fast View Reindex
Current: ~10 blocks/sec (fetch from node → parse → run handler)
With snapshots: ~1000 blocks/sec (read pre-indexed events → run handler)

---

## Proposed Features

### Tier 1: Core Infrastructure

| Feature | Description |
|---------|-------------|
| Daily Snapshots | Automated pg_dump to R2 |
| Public Downloads | Hosted at snapshots.secondlayer.tools |
| Manifest API | `GET /snapshots/latest` |

### Tier 2: Client-Facing

| Feature | Description |
|---------|-------------|
| Historical Query API | `GET /streams/{id}/history` |
| Fast View Reindex | Replay from indexed events, not node |
| Bulk Export | Download filtered events as CSV/JSON |

### Tier 3: Advanced

| Feature | Description |
|---------|-------------|
| Read Replica Access | SQL access for power users |
| Snapshot Subscriptions | Webhook on new snapshot |
| Incremental Snapshots | Delta updates since last snapshot |

---

## Implementation Priority

1. **Phase 1: Internal ops** — Daily snapshots, restore runbook, staging refresh
2. **Phase 2: Self-hosted support** — Public downloads, manifest API, docs
3. **Phase 3: Client features** — Historical query API, fast reindex, bulk export
4. **Phase 4: Advanced** — Read replicas, incremental snapshots, subscriptions

---

## Distribution Architecture

### Two-Tier Storage

| | Hetzner Storage Box | Cloudflare R2 |
|---|---|---|
| **Purpose** | Private backup/DR | Public distribution |
| **Access** | SFTP, rsync, SMB | HTTPS, S3 API |
| **Egress** | ~€1/TB | Free |
| **Cost** | ~€3.50/mo (1TB) | ~$15/mo (1TB) |
| **Retention** | 30+ days | 7 days |

```
Production DB
    ↓ daily pg_dump
Hetzner Storage Box     ← private backup, cheap, long retention
    ↓ rsync
Cloudflare R2           ← public downloads, no egress fees, CDN
```

### Directory Structure

```
s3://secondlayer-snapshots/
├── latest.json
├── mainnet/
│   ├── 2026-02-05/
│   │   ├── snapshot.tar.zst
│   │   ├── snapshot.sha256
│   │   └── manifest.json
│   └── ...
└── testnet/
    └── ...
```

### Manifest Format

```json
{
  "version": 1,
  "network": "mainnet",
  "created_at": "2026-02-05T00:00:00Z",
  "block_height": 180000,
  "block_hash": "0x...",
  "tables": {
    "blocks": { "rows": 180000, "bytes": 524288000 },
    "transactions": { "rows": 5000000, "bytes": 53687091200 },
    "events": { "rows": 20000000, "bytes": 107374182400 }
  },
  "format": "pg_dump_directory",
  "compression": "zstd",
  "checksum": "sha256:abc123..."
}
```

### Automation Cron

```bash
# /etc/cron.d/secondlayer-snapshot
0 2 * * * root /opt/secondlayer/scripts/create-snapshot.sh >> /var/log/snapshot.log 2>&1
```

---

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| New deployment time | Days/weeks | < 2 hours |
| Stream backfill (30 days) | Hours | < 5 minutes |
| View reindex (full history) | Hours | < 10 minutes |
| Disaster recovery RTO | Days | < 2 hours |
| Self-hosted setup time | Weeks | < 1 day |

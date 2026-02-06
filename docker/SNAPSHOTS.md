# Indexer Data Snapshots

Strategy for creating and distributing snapshots of indexed blockchain data to enable fast replay/backfill without resyncing from the node.

## Overview

**Goal:** Allow new deployments or disaster recovery to restore indexed state in hours instead of days/weeks of resyncing.

**What gets snapshotted:**
| Table | Size (est.) | Purpose |
|-------|-------------|---------|
| `blocks` | ~500 MB | Block headers, hashes, canonical flag |
| `transactions` | ~50 GB | Parsed txs with sender, contract_id, function_name |
| `events` | ~100 GB | All on-chain events (JSONB) |
| `index_progress` | <1 KB | Sync state metadata |

**What does NOT need snapshotting:**
- `jobs` - ephemeral work queue
- `deliveries` - can be regenerated via replay
- `streams` / `stream_metrics` - user config, not indexed data
- `views` / view schemas - derived data, can reindex from blocks/txs/events

---

## Architecture

```
Production DB
    ↓ streaming replication (optional but recommended)
Snapshot Replica
    ↓ daily cron
pg_dump -Fd -j8 --compress=zstd:level=3
    ↓
    ├──→ Hetzner Storage Box (private backup, 30-day retention)
    │
    └──→ Cloudflare R2 (public distribution, 7-day retention)
             ↓
         Public download with SHA256 checksums
```

---

## Creating Snapshots

### Option 1: Full pg_dump (Simple)

Best for small-medium deployments or one-off snapshots.

```bash
#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d)
OUTDIR="/tmp/secondlayer-snapshot-${TIMESTAMP}"
TABLES="blocks,transactions,events,index_progress"

# Dump specific tables with parallel jobs and zstd compression
pg_dump \
  --format=directory \
  --jobs=8 \
  --compress=zstd:level=3 \
  --table=blocks \
  --table=transactions \
  --table=events \
  --table=index_progress \
  --file="$OUTDIR" \
  "$DATABASE_URL"

# Create checksum
cd /tmp
tar -cf - "secondlayer-snapshot-${TIMESTAMP}" | zstd -3 > "secondlayer-snapshot-${TIMESTAMP}.tar.zst"
sha256sum "secondlayer-snapshot-${TIMESTAMP}.tar.zst" > "secondlayer-snapshot-${TIMESTAMP}.sha256"

echo "Snapshot created:"
ls -lh /tmp/secondlayer-snapshot-${TIMESTAMP}.*
```

### Option 2: COPY Export (Portable)

Exports raw data as TSV files. More portable, can be imported into different schemas.

```bash
#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d)
OUTDIR="/tmp/secondlayer-export-${TIMESTAMP}"
mkdir -p "$OUTDIR"

# Export each table as compressed TSV
for TABLE in blocks transactions events index_progress; do
  psql "$DATABASE_URL" -c "\COPY $TABLE TO STDOUT WITH (FORMAT csv, HEADER)" \
    | zstd -3 > "$OUTDIR/${TABLE}.csv.zst"
done

# Create manifest
cat > "$OUTDIR/manifest.json" << EOF
{
  "version": 1,
  "created_at": "$(date -Iseconds)",
  "tables": ["blocks", "transactions", "events", "index_progress"],
  "format": "csv",
  "compression": "zstd"
}
EOF

# Checksums
cd "$OUTDIR"
sha256sum *.zst > checksums.sha256
```

### Option 3: Incremental via Partitioning (Advanced)

For large-scale deployments. Partition tables by block height ranges, snapshot completed partitions.

```sql
-- Example: partition events by block height (100k blocks per partition)
CREATE TABLE events_partitioned (
  LIKE events INCLUDING ALL
) PARTITION BY RANGE (block_height);

CREATE TABLE events_p0 PARTITION OF events_partitioned
  FOR VALUES FROM (0) TO (100000);
CREATE TABLE events_p1 PARTITION OF events_partitioned
  FOR VALUES FROM (100000) TO (200000);
-- etc.
```

Then snapshot only completed (immutable) partitions:
```bash
pg_dump --table=events_p0 --table=events_p1 ...
```

---

## Restoring Snapshots

### From pg_dump Directory Format

```bash
# Download and verify
curl -LO https://snapshots.secondlayer.tools/secondlayer-snapshot-20260205.tar.zst
curl -LO https://snapshots.secondlayer.tools/secondlayer-snapshot-20260205.sha256
sha256sum -c secondlayer-snapshot-20260205.sha256

# Extract
zstd -d secondlayer-snapshot-20260205.tar.zst
tar -xf secondlayer-snapshot-20260205.tar

# Restore with parallel jobs
pg_restore \
  --jobs=8 \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  secondlayer-snapshot-20260205/
```

### From CSV Export

```bash
# Download and extract
for TABLE in blocks transactions events index_progress; do
  curl -LO "https://snapshots.secondlayer.tools/export/${TABLE}.csv.zst"
  zstd -d "${TABLE}.csv.zst"
done

# Truncate and import
psql "$DATABASE_URL" << 'EOF'
TRUNCATE blocks, transactions, events, index_progress CASCADE;
\COPY blocks FROM 'blocks.csv' WITH (FORMAT csv, HEADER);
\COPY transactions FROM 'transactions.csv' WITH (FORMAT csv, HEADER);
\COPY events FROM 'events.csv' WITH (FORMAT csv, HEADER);
\COPY index_progress FROM 'index_progress.csv' WITH (FORMAT csv, HEADER);
EOF
```

### PostgreSQL Tuning for Fast Restore

Temporarily adjust settings during restore:

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

## Distribution

We use a two-tier storage strategy:

| | Hetzner Storage Box | Cloudflare R2 |
|---|---|---|
| **Purpose** | Private backup/disaster recovery | Public distribution |
| **Access** | SFTP, rsync, SMB | HTTPS, S3 API |
| **Egress** | Metered (~€1/TB) | Free |
| **Cost** | ~€3.50/month (1TB) | ~$15/month (1TB stored) |
| **Best for** | Internal ops, offsite backup | Client downloads, automation |
| **Retention** | Long-term archive (30+ days) | Recent snapshots (7 days) |

```
Production DB
    ↓ daily pg_dump
Hetzner Storage Box     ← private backup, cheap, long retention
    ↓ rsync
Cloudflare R2           ← public downloads, no egress fees, CDN
```

---

### Tier 1: Hetzner Storage Box (Backup)

Private offsite backup. Cheap storage with long retention for disaster recovery.

**Setup:**
1. Create Storage Box via [Hetzner Robot](https://robot.hetzner.com) → Storage → Storage Box
2. Enable SSH/rsync access in sub-account settings
3. Add SSH key for passwordless uploads

```bash
# Upload via rsync
rsync -avz --progress \
  secondlayer-snapshot-20260205.tar.zst \
  uXXXXXX@uXXXXXX.your-storagebox.de:./snapshots/

# Or via SFTP
sftp uXXXXXX@uXXXXXX.your-storagebox.de <<< "put secondlayer-snapshot-20260205.tar.zst snapshots/"
```

**Retention policy:** Keep 30 days of daily snapshots + weekly snapshots for 6 months.

```bash
# Cleanup old snapshots (keep last 30 days)
ssh uXXXXXX@uXXXXXX.your-storagebox.de \
  'find snapshots/ -name "*.tar.zst" -mtime +30 -delete'
```

---

### Tier 2: Cloudflare R2 (Public Distribution)

Public downloads for clients and self-hosted deployments. No egress fees.

```bash
# Upload via AWS CLI (R2 is S3-compatible)
export AWS_ACCESS_KEY_ID="your-r2-access-key"
export AWS_SECRET_ACCESS_KEY="your-r2-secret-key"
export AWS_ENDPOINT_URL="https://<account-id>.r2.cloudflarestorage.com"

aws s3 cp secondlayer-snapshot-20260205.tar.zst s3://secondlayer-snapshots/
aws s3 cp secondlayer-snapshot-20260205.sha256 s3://secondlayer-snapshots/
```

**Retention policy:** Keep 7 days of daily snapshots (clients only need recent ones).

---

### Directory Structure

```
s3://secondlayer-snapshots/
├── latest.json                    # Points to latest snapshot
├── mainnet/
│   ├── 2026-02-05/
│   │   ├── snapshot.tar.zst
│   │   ├── snapshot.sha256
│   │   └── manifest.json
│   └── 2026-02-04/
│       └── ...
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

---

## Automation

### Daily Snapshot Cron

```bash
# /etc/cron.d/secondlayer-snapshot
0 2 * * * root /opt/secondlayer/scripts/create-snapshot.sh >> /var/log/snapshot.log 2>&1
```

### Sample Script

```bash
#!/bin/bash
# /opt/secondlayer/scripts/create-snapshot.sh
set -euo pipefail

TIMESTAMP=$(date +%Y-%m-%d)
WORKDIR="/tmp/snapshot-${TIMESTAMP}"
S3_BUCKET="s3://secondlayer-snapshots/mainnet/${TIMESTAMP}"
STORAGE_BOX="uXXXXXX@uXXXXXX.your-storagebox.de"

# Create snapshot
mkdir -p "$WORKDIR"
pg_dump \
  --format=directory \
  --jobs=8 \
  --compress=zstd:level=3 \
  --table=blocks \
  --table=transactions \
  --table=events \
  --table=index_progress \
  --file="$WORKDIR/data" \
  "$DATABASE_URL"

# Get metadata
BLOCK_HEIGHT=$(psql "$DATABASE_URL" -t -c "SELECT last_contiguous_block FROM index_progress WHERE network='mainnet'")
BLOCK_HASH=$(psql "$DATABASE_URL" -t -c "SELECT hash FROM blocks WHERE height=$BLOCK_HEIGHT AND canonical=true")

# Create manifest
cat > "$WORKDIR/manifest.json" << EOF
{
  "version": 1,
  "network": "mainnet",
  "created_at": "$(date -Iseconds)",
  "block_height": $BLOCK_HEIGHT,
  "block_hash": "$BLOCK_HASH",
  "format": "pg_dump_directory",
  "compression": "zstd"
}
EOF

# Package
cd "$WORKDIR"
tar -cf - data manifest.json | zstd -3 > snapshot.tar.zst
sha256sum snapshot.tar.zst > snapshot.sha256

# ============================================
# Tier 1: Upload to Storage Box (private backup)
# ============================================
echo "Uploading to Storage Box..."
rsync -avz --progress \
  snapshot.tar.zst snapshot.sha256 manifest.json \
  "${STORAGE_BOX}:./snapshots/mainnet/${TIMESTAMP}/"

# Cleanup old Storage Box snapshots (keep 30 days)
ssh "$STORAGE_BOX" 'find snapshots/ -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true'

# ============================================
# Tier 2: Upload to R2 (public distribution)
# ============================================
echo "Uploading to R2..."
aws s3 cp snapshot.tar.zst "$S3_BUCKET/"
aws s3 cp snapshot.sha256 "$S3_BUCKET/"
aws s3 cp manifest.json "$S3_BUCKET/"

# Update latest pointer
echo "{\"latest\": \"mainnet/${TIMESTAMP}\"}" | aws s3 cp - s3://secondlayer-snapshots/latest.json

# Cleanup old R2 snapshots (keep 7 days)
aws s3 ls s3://secondlayer-snapshots/mainnet/ | while read -r line; do
  DIR=$(echo "$line" | awk '{print $2}' | tr -d '/')
  if [[ "$DIR" < "$(date -d '7 days ago' +%Y-%m-%d)" ]]; then
    aws s3 rm --recursive "s3://secondlayer-snapshots/mainnet/${DIR}/"
  fi
done

# Cleanup local
rm -rf "$WORKDIR"

echo "Snapshot uploaded to Storage Box and R2"
```

---

## Post-Restore: Catching Up

After restoring a snapshot, the indexer and views need to catch up:

```bash
# 1. Start services
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d

# 2. Check sync progress
curl -s http://localhost:3700/health/integrity | jq

# 3. Views will auto-catch-up from last_processed_block
# Streams will process new blocks as they arrive

# 4. Optional: replay historical blocks for streams
curl -X POST "http://localhost:3800/streams/{id}/replay" \
  -H "Content-Type: application/json" \
  -d '{"fromBlock": 175000, "toBlock": 180000}'
```

---

## Prior Art

- **[Hiro Archive](https://docs.hiro.so/stacks/archive)** - Daily Stacks blockchain snapshots at `archive.hiro.so`
- **[Subsquid](https://docs.sqd.ai/)** - Decentralized archive data lakes, 50k+ blocks/sec
- **[pgBackRest](https://pgbackrest.org/)** - Block-level incremental PostgreSQL backups

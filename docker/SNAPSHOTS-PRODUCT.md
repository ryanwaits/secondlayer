# Snapshots: Product & UX Perspective

How indexer snapshots improve the experience for Secondlayer operators and clients.

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

### Internal Operations (Secondlayer Team)

#### 1. Disaster Recovery
> "Our production database crashed. We need to restore service ASAP."

| Without Snapshot | With Snapshot |
|------------------|---------------|
| Resync from block 0 | Restore latest snapshot |
| Days to weeks | Hours |
| Extended downtime | Minimal downtime |

#### 2. New Region Deployment
> "We're launching EU servers for lower latency."

Restore snapshot to new region, catch up a few hundred blocks, route traffic. New region online same day.

#### 3. Staging & Testing
> "QA needs production-like data to test a migration."

Restore yesterday's snapshot to staging. Realistic test data without impacting production or manually seeding.

#### 4. Debugging Production Issues
> "A client reports their view had incorrect data at block 175,000."

Restore snapshot locally, replay the specific block range, step through handler logic, identify the bug.

---

### Client-Facing (Streams & Views Users)

#### 5. New Stream with Historical Data
> "I just created a stream to track ALEX trades. I need the last 30 days of data, not just new blocks."

**Current experience:**
```
1. Create stream via API
2. Request backfill: POST /streams/{id}/replay { fromBlock: 170000 }
3. Wait for 10,000 blocks to process through queue
4. Receive webhooks over hours/days
```

**With snapshot-powered backfill:**
```
1. Create stream via API
2. Request historical data: GET /streams/{id}/history?from=170000
3. Receive paginated JSON response immediately
4. New blocks delivered via webhook in real-time
```

#### 6. Self-Hosted Indexer
> "We need to run our own indexer for compliance/data sovereignty."

**Current:** Sync from scratch = weeks of waiting

**With public snapshots:**
```bash
# Download latest snapshot
curl -LO https://snapshots.secondlayer.tools/mainnet/latest.tar.zst

# Restore and start
pg_restore -j8 -d $DATABASE_URL snapshot/
docker compose up -d

# Running in hours, syncs remaining blocks automatically
```

#### 7. View Schema Migration
> "I updated my view handler logic and need to reprocess all historical blocks."

**Current:** Reindex fetches each block from the node, parses transactions, then runs handler. ~10 blocks/sec.

**With snapshots:** Reindex reads pre-indexed events directly from database, only runs handler logic. ~1000 blocks/sec. 100x faster.

#### 8. Analytics & Reporting
> "I want to analyze NFT trading patterns over the last year."

**Option A: Build a stream, backfill, aggregate yourself**
- Create stream with NFT filters
- Wait for backfill to complete
- Store in your own database
- Write aggregation queries

**Option B: Query our historical data directly**
```sql
-- Via read replica access or data export
SELECT
  date_trunc('week', b.timestamp) as week,
  e.data->>'asset_id' as collection,
  count(*) as trades,
  sum((e.data->>'amount')::numeric) as volume
FROM events e
JOIN blocks b ON e.block_height = b.height
WHERE e.type = 'nft_transfer'
  AND b.timestamp > now() - interval '1 year'
GROUP BY 1, 2
ORDER BY 1, 4 DESC
```

#### 9. Webhook Delivery Failures
> "Our server was down for 2 hours and we missed webhook deliveries."

**Current:** Use replay-failed endpoint to re-queue, wait for reprocessing

**With snapshots:** Query missed blocks directly via API, get data immediately, then resume real-time webhooks

---

## Proposed Features

### Tier 1: Core Infrastructure

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Daily Snapshots** | Automated pg_dump to R2 | Fast disaster recovery |
| **Public Snapshot Downloads** | Hosted at snapshots.secondlayer.tools | Self-hosted deployments |
| **Snapshot Manifest API** | `GET /snapshots/latest` | Automation-friendly |

### Tier 2: Client-Facing Improvements

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Historical Query API** | `GET /streams/{id}/history` | Instant backfill without webhooks |
| **Fast View Reindex** | Replay from indexed events, not node | 100x faster reindex |
| **Bulk Export** | Download filtered events as CSV/JSON | Offline analytics |

### Tier 3: Advanced

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Read Replica Access** | SQL access for power users | Custom analytics |
| **Snapshot Subscriptions** | Webhook when new snapshot published | Automated sync pipelines |
| **Incremental Snapshots** | Only changed data since last snapshot | Faster downloads, less storage |

---

## Example Flows

### Flow 1: New Client Onboarding

```
┌─────────────────────────────────────────────────────────────┐
│ Client: "I want to track all STX transfers > 1M STX"        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Create stream                                            │
│    POST /streams                                            │
│    { "name": "whale-transfers",                             │
│      "filters": { "stx": { "minAmount": 1000000 } },        │
│      "webhook_url": "https://client.com/webhook" }          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Get historical data (NEW - snapshot-powered)             │
│    GET /streams/{id}/history?fromBlock=150000&limit=1000    │
│                                                             │
│    Response:                                                │
│    { "data": [...1000 matching events...],                  │
│      "nextCursor": "...",                                   │
│      "hasMore": true }                                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Paginate through history until caught up                 │
│    GET /streams/{id}/history?cursor=...                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Real-time updates via webhook                            │
│    POST https://client.com/webhook                          │
│    { "block": 180001, "events": [...] }                     │
└─────────────────────────────────────────────────────────────┘
```

**Result:** Client has full historical data in minutes, not hours/days.

---

### Flow 2: View Reindex After Handler Fix

```
┌─────────────────────────────────────────────────────────────┐
│ Client: "I fixed a bug in my handler, need to reindex"      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ POST /views/{id}/reindex                                    │
│ { "fromBlock": 100000 }                                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
┌─────────────────────────┐  ┌─────────────────────────────────┐
│ CURRENT                 │  │ WITH SNAPSHOTS                  │
│                         │  │                                 │
│ For each block:         │  │ For each block:                 │
│ 1. Fetch from node/API  │  │ 1. Read from events table       │
│ 2. Parse transactions   │  │ 2. Run handler                  │
│ 3. Decode events        │  │                                 │
│ 4. Run handler          │  │ Skip steps 1-3 (pre-indexed)    │
│                         │  │                                 │
│ ~10 blocks/sec          │  │ ~1000 blocks/sec                │
│ 80,000 blocks = 2+ hrs  │  │ 80,000 blocks = ~80 sec         │
└─────────────────────────┘  └─────────────────────────────────┘
```

---

### Flow 3: Self-Hosted Deployment

```
┌─────────────────────────────────────────────────────────────┐
│ Enterprise client: "We need to run this in our own cloud"   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Check latest snapshot                                    │
│    GET https://snapshots.secondlayer.tools/mainnet/latest   │
│                                                             │
│    { "block_height": 179500,                                │
│      "url": "https://.../snapshot-2026-02-05.tar.zst",      │
│      "checksum": "sha256:abc123...",                        │
│      "size_bytes": 161061273600 }                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Download and verify                                      │
│    curl -LO .../snapshot-2026-02-05.tar.zst                 │
│    sha256sum -c snapshot.sha256                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Restore                                                  │
│    pg_restore -j8 -d $DATABASE_URL snapshot/                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Start services                                           │
│    docker compose up -d                                     │
│                                                             │
│    Indexer detects last_contiguous_block = 179500           │
│    Catches up ~500 blocks from node                         │
│    Fully operational in < 1 hour                            │
└─────────────────────────────────────────────────────────────┘
```

---

### Flow 4: Disaster Recovery

```
┌─────────────────────────────────────────────────────────────┐
│ Alert: "Production database unresponsive"                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Spin up new database instance                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Restore from last night's snapshot                       │
│    - Snapshot block: 179000                                 │
│    - Current tip: 179800                                    │
│    - Gap: 800 blocks                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Start indexer, catches up 800 blocks (~10 min)           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Replay failed webhook deliveries for affected streams    │
│    POST /streams/{id}/replay-failed                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Total downtime: ~1 hour                                     │
│ (vs days/weeks without snapshots)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Metrics & Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| New deployment time | Days/weeks | < 2 hours |
| Stream backfill (30 days) | Hours | < 5 minutes |
| View reindex (full history) | Hours | < 10 minutes |
| Disaster recovery RTO | Days | < 2 hours |
| Self-hosted setup time | Weeks | < 1 day |

---

## Implementation Priority

1. **Phase 1: Internal ops** (immediate value)
   - Daily automated snapshots
   - Restore runbook
   - Staging environment refresh

2. **Phase 2: Self-hosted support** (enterprise clients)
   - Public snapshot downloads
   - Snapshot manifest API
   - Documentation

3. **Phase 3: Client-facing features** (product differentiation)
   - Historical query API
   - Fast view reindex
   - Bulk export

4. **Phase 4: Advanced** (scale)
   - Read replica access
   - Incremental snapshots
   - Snapshot subscriptions

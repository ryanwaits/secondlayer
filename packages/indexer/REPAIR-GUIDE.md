# Transaction Repair Script

Repairs missing `function_args` and `raw_result` for contract_call transactions using Hiro API.

## Current State Check

First, check how many transactions need repair:

```bash
cd /opt/secondlayer

# Total missing function_args
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT COUNT(*) FROM transactions WHERE type = 'contract_call' AND function_args IS NULL;"

# Total missing raw_result
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT COUNT(*) FROM transactions WHERE type = 'contract_call' AND raw_result IS NULL;"

# Missing both
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT COUNT(*) FROM transactions WHERE type = 'contract_call' AND function_args IS NULL AND raw_result IS NULL;"

# By block range (the 7.4M range)
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT MIN(block_height), MAX(block_height), COUNT(*) FROM transactions WHERE type = 'contract_call' AND (function_args IS NULL OR raw_result IS NULL) AND block_height BETWEEN 7420000 AND 7450000;"
```

## Test Run (100 blocks)

Run in dry-run mode first to verify the approach:

```bash
cd /opt/secondlayer

# Dry run - logs only, no DB changes
HIRO_API_KEY=4ec363c60b6aca08ece1c145ac2879d5 \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/secondlayer \
REPAIR_FROM=7429554 \
REPAIR_TEST_BLOCKS=100 \
REPAIR_BATCH_SIZE=5 \
REPAIR_TX_CONCURRENCY=2 \
REPAIR_DRY_RUN=true \
bun run packages/indexer/src/repair-transactions.ts
```

Expected output:
- Processes 100 blocks (7429554-7429653)
- Reports how many transactions need repair
- Shows sample of what would be fetched from Hiro API
- No DB changes made

## Verify Test Results

Check the dry run output for:
- API calls completed without 429 errors
- Transactions identified for repair
- Data sources used ("decode" vs "api")

## Production Run (100 blocks)

If test looks good, run for real:

```bash
cd /opt/secondlayer

# Remove any stale progress file
rm -f repair-progress.json

# Run with actual DB updates
HIRO_API_KEY=4ec363c60b6aca08ece1c145ac2879d5 \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/secondlayer \
REPAIR_FROM=7429554 \
REPAIR_TEST_BLOCKS=100 \
REPAIR_BATCH_SIZE=5 \
REPAIR_TX_CONCURRENCY=2 \
bun run packages/indexer/src/repair-transactions.ts
```

## Verify Repairs

After the run completes:

```bash
# Check repairs were applied
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT block_height, COUNT(*) FROM transactions WHERE type = 'contract_call' AND (function_args IS NULL OR raw_result IS NULL) AND block_height BETWEEN 7429554 AND 7429653 GROUP BY block_height ORDER BY block_height;"
```

## Full Repair Strategy

Once the 100-block test is verified, you have options:

### Option A: Continue Incrementally

```bash
# Resume from where test left off (automatic resume)
HIRO_API_KEY=4ec363c60b6aca08ece1c145ac2879d5 \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/secondlayer \
REPAIR_TEST_BLOCKS=500 \
REPAIR_BATCH_SIZE=10 \
bun run packages/indexer/src/repair-transactions.ts

# Keep running until repair-progress.json shows completed: true
```

### Option B: Full Range (11K blocks)

```bash
# Remove progress to start fresh
rm -f repair-progress.json

# Run entire 7.4M range
HIRO_API_KEY=4ec363c60b6aca08ece1c145ac2879d5 \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/secondlayer \
REPAIR_FROM=7429554 \
REPAIR_TO=7440670 \
REPAIR_BATCH_SIZE=10 \
REPAIR_TX_CONCURRENCY=3 \
bun run packages/indexer/src/repair-transactions.ts

# Takes ~2-4 hours with conservative settings
```

## Resume Capability

The script saves progress to `repair-progress.json`. If interrupted, just re-run the same command - it will auto-resume.

To force restart from beginning:
```bash
rm -f repair-progress.json
```

## Rate Limiting

With your API key, Hiro allows ~50 req/sec. The script uses:
- 100ms between calls (10 req/sec) - conservative
- Exponential backoff on 429s
- MAX_RETRIES = 5 per request

## Safety Features

1. **Dry run mode**: Test without touching DB
2. **Resume**: Automatic progress tracking
3. **Bounded concurrency**: Configurable TX_CONCURRENCY
4. **Small batches**: Configurable BATCH_SIZE
5. **Transaction updates**: Uses upsert pattern, idempotent

## Troubleshooting

### 429 Rate Limited

Increase backoff or reduce concurrency:
```bash
REPAIR_TX_CONCURRENCY=1 \
REPAIR_BATCH_SIZE=3 \
bun run packages/indexer/src/repair-transactions.ts
```

### Too Slow

Carefully increase (watch for 429s):
```bash
REPAIR_TX_CONCURRENCY=5 \
REPAIR_BATCH_SIZE=20 \
bun run packages/indexer/src/repair-transactions.ts
```

### Missing Data Still

Some transactions may legitimately not have raw_result (aborted calls, etc). Check:
```bash
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "SELECT status, COUNT(*) FROM transactions WHERE type = 'contract_call' AND raw_result IS NULL GROUP BY status;"
```

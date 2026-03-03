# Backfill & Data Population

How to populate the indexer database with blockchain data.

---

## Strategy Overview

| Strategy | Speed | Use Case |
|----------|-------|----------|
| **Genesis sync** (event observer) | ~1 block/12s | Clean slate, complete data with real raw_tx |
| **Hiro remote backfill** | Rate-limited | Fill gaps, bootstrap without a node |
| **Local reprocessing** | Fast (local DB) | Re-index after schema changes |

### Recommended: Genesis Sync

The stacks-node event observer pushes every block (with full raw_tx hex) directly to the indexer. This is the cleanest approach — no placeholder data, no self-hosted Hiro API required.

See [OPERATIONS.md — Genesis Sync](OPERATIONS.md#genesis-sync) for the full procedure.

---

## Gap-Fill (Automatic)

The indexer's integrity loop runs every 5 minutes and automatically fills detected gaps:

1. **Local DB first** — `LocalClient.getBlockForReplay()` reconstructs blocks from our own Postgres (for re-orgs, reprocessing)
2. **Hiro remote fallback** — fetches from `api.mainnet.hiro.so` if block isn't in local DB

No manual intervention needed. Monitor:

```bash
curl -s localhost:3700/health/integrity | jq
docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
  -c "SELECT * FROM index_progress;"
```

---

## Bulk Backfill (Manual)

For large-scale population or reprocessing:

```bash
docker run -d --name backfill \
  --network secondlayer_default \
  -v /opt/secondlayer:/app -w /app \
  -e DATABASE_URL=postgres://secondlayer:secondlayer@postgres:5432/secondlayer \
  -e HIRO_API_URL=https://api.mainnet.hiro.so \
  -e HIRO_API_KEY=${HIRO_API_KEY:-} \
  -e BACKFILL_SOURCE=hiro \
  -e BACKFILL_CONCURRENCY=20 \
  -e BACKFILL_BATCH_SIZE=100 \
  -e BACKFILL_FROM=2 \
  oven/bun:latest bun run packages/indexer/src/bulk-backfill.ts
```

### Sources

| Source | Env | Description |
|--------|-----|-------------|
| `hiro` | `BACKFILL_SOURCE=hiro` | Fetch from Hiro's public API (default) |
| `local` | `BACKFILL_SOURCE=local` | Replay from own Postgres (reprocessing) |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_SOURCE` | `hiro` | Data source |
| `BACKFILL_FROM` | `2` | Start height (skip genesis block 1 — 330K events) |
| `BACKFILL_TO` | auto | End height (auto-detects chain tip) |
| `BACKFILL_CONCURRENCY` | `20` | Parallel fetches |
| `BACKFILL_BATCH_SIZE` | `100` | Blocks per DB batch |

### Management

```bash
docker logs backfill 2>&1 | grep "Batch complete" | tail -5
docker stop backfill && docker rm backfill
```

---

## Chainstate Snapshot

Bootstrap the stacks-node from Hiro's chainstate archive instead of syncing from scratch (~800-900 GB extracted).

```bash
# Stream directly to disk
wget -qO- https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz \
  | tar xzf - -C /mnt/chainstate
```

Or with resume support:
```bash
curl --continue-at - -L -o /tmp/snapshot.tar.gz \
  https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz
tar -xzf /tmp/snapshot.tar.gz -C /mnt/chainstate
rm /tmp/snapshot.tar.gz
```

> Using a chainstate snapshot means the node won't push historical blocks to the indexer. You'd still need a backfill strategy for the indexer DB. Genesis sync is recommended if you want complete, clean data.

---

## Troubleshooting

### "Unknown payload type: N"

All 9 Stacks payload types are supported (TokenTransfer, SmartContract, ContractCall, Coinbase, CoinbaseToAltRecipient, PoisonMicroblock, VersionedSmartContract, TenureChange, NakamotoCoinbase). If you see this error, ensure the Docker image was rebuilt with the latest `@secondlayer/stacks` package.

### Block 1 Takes Forever

Genesis block has 330K events (STX allocations). Set `BACKFILL_FROM=2` to skip, or let the integrity loop handle it.

### "Batch insert failed: invalid byte sequence for encoding UTF8: 0x00"

Fixed in code — null bytes are stripped before DB insert. Pull latest and rebuild.

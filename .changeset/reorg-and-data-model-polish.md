---
"@secondlayer/api": minor
"@secondlayer/indexer": patch
---

Reorg + data model polish:

- Streams event rows now include `canonical: true` so clients can write type-safe reorg-aware code. (Field is optional in the SDK type to preserve backwards compatibility.)
- Index `/v1/index/ft-transfers` and `/v1/index/nft-transfers` row projections now include `block_time` (ISO 8601 UTC, sourced via subquery on the canonical block).
- Streams cursor-less default window tightened from `tip - 1 day` (~17280 blocks) to `tip - 1000 blocks` (~80 min) so first-touch responses surface recent data instead of stale events ~17k blocks behind tip. Indexer-style backfill consumers should pass `from_height=0` or an explicit cursor as before.
- `microblock_hash` field on events deferred — requires a `blocks` table schema change; tracked separately.

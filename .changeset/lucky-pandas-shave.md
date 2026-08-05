---
"@secondlayer/sdk": minor
---

`subgraphs.reindex()` no longer accepts `fromBlock`/`toBlock`. The API rejects a ranged reindex with `400 REINDEX_RANGE_NOT_SUPPORTED`, so the old signature type-checked and failed at runtime. Use `subgraphs.backfill(name, { fromBlock, toBlock })` for a specific range.

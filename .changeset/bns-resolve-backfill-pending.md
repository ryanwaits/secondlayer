---
"@secondlayer/api": patch
---

`/v1/datasets/bns/resolve` now distinguishes "name not in indexed range" from "name does not exist". When `bns_names` earliest indexed block exceeds the BNS-V2 history threshold, the endpoint returns `503 BACKFILL_PENDING` with `earliest_indexed_block` instead of a generic `404`. Defends against the launch-day "muneeb.btc returns not found" failure mode while the historical backfill catches up.

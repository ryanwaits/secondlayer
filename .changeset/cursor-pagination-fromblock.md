---
"@secondlayer/api": patch
---

Bound cursor pagination to `cursor.block_height` instead of 0. Paginated dataset requests (stx-transfers, sbtc, bns, pox-4) previously scanned full event history on every page (~30s timeout). The cursor predicate already enforces strict `>`, so the lower-bound shrink is safe.

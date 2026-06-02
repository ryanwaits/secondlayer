---
"@secondlayer/indexer": patch
---

Consolidate the duplicated dataset row-normalization helpers (`nullableInt` and the TIMESTAMPTZ→ISO `block_time` coercion) into `datasets/_shared/row.ts`, replacing per-query copies across the pox-4, sBTC, and BNS dataset queries. No behavior change.

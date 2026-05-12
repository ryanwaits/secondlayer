---
"@secondlayer/api": patch
---

`/v1/datasets/bns/namespaces` now distinguishes "no namespace events ever" from "backfill hasn't reached the era when .btc / .id were created". When the projection is empty AND the indexed range starts past the BNS-V2 history threshold, the response includes `status: 'backfill_pending'` and `earliest_indexed_block`. Mirrors the signal already emitted by `/v1/datasets/bns/resolve`.

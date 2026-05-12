---
"@secondlayer/api": patch
---

`/v1/datasets/bns/names` now supports cursor pagination via `?cursor=<bns_id>` and rejects the previously-silent `offset` param. Response shape gains `next_cursor: string | null`, matching the envelope used by the other dataset endpoints. Order changed from `fqn ASC` to `bns_id ASC` (the on-chain mint sequence) for stable forward iteration.

---
"@secondlayer/indexer": patch
---

Decoder firehose backfill decodes resume/page cursors with `decodeStreamsCursor` instead of `split` + `Number`.

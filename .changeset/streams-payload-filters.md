---
"@secondlayer/api": minor
"@secondlayer/sdk": minor
"@secondlayer/indexer": minor
---

Streams events now support `sender`, `recipient`, and `asset_identifier` filters on `/v1/streams/events` (and the SDK `events.list`/`consume`/`stream`), matching Index's principal/asset filters. They apply as exact-match predicates on the raw event payload, so event types lacking the field simply don't match — the firehose narrows naturally. Closes the query-parity gap with Index.

---
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/api": minor
"@secondlayer/indexer": minor
---

Add exclusion and multi-value filters to the Streams events firehose. `not_types` excludes event types, and `contract_id`, `sender`, and `recipient` now accept comma-separated lists (matching any value). Exposed on `GET /v1/streams/events`, the SDK (`events.list/consume/stream` accept `notTypes` and `string | string[]` filters), and the `sl streams events`/`consume` CLI (`--not-types`, `--sender`, `--recipient`, comma lists on `--contract-id`).

No new indexes: `not_types` narrows the existing `type IN (...)` set and the list filters reuse the same range-bounded `events.data` access path as the single-value filters, so the query plan is unchanged.

---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
"@secondlayer/indexer": minor
"@secondlayer/api": minor
---

Index now decodes and serves Clarity `print` events. `GET /v1/index/events?event_type=print` returns each print's `topic`, the Clarity `value` decoded to JSON (uints as strings, buffers as `0x…` hex, tuples as objects), and the canonical `raw_value` hex — filterable by `contract_id`.

SDK adds `decodePrint` / `isPrint` and the `DecodedPrint` types (depends on `@secondlayer/stacks` for Clarity decoding). A nullable `payload` JSONB column is added to `decoded_events` to hold decoded values that don't fit the flat transfer columns. The indexer runs a `print` decoder; the API registry and OpenAPI expose it.

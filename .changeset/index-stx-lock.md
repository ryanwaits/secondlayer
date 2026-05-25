---
"@secondlayer/sdk": minor
"@secondlayer/indexer": minor
"@secondlayer/api": minor
---

Index now serves `stx_lock` (stacking lock) events via `GET /v1/index/events?event_type=stx_lock`. The locked principal maps to `sender`, the locked uSTX to `amount`, and `unlock_height` rides in `payload` (`{ unlock_height }`) — filterable by `sender`. SDK adds `decodeStxLock` / `isStxLock` + `DecodedStxLock` types and the `IndexStxLock` client variant. No migration: reuses the existing `decoded_events.payload` jsonb column.

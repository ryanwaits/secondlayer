---
"@secondlayer/shared": minor
"@secondlayer/indexer": minor
---

Add opt-in payload validation with a dead-letter log on ingest. When `STREAMS_PAYLOAD_VALIDATION=true` (default off), each event's decoded payload is checked against the minimal shape its type requires; malformed payloads are recorded in a new `dead_letter_events` table (migration 0085) with a reason. The event itself is still persisted — chain data is never dropped — so this is a diagnostic log, not a gate. Default-off keeps the ingest hot path lean.

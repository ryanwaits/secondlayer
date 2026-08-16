---
"@secondlayer/indexer": patch
---

The daily canonical-audit now checks a bounded trailing window for tx/event height desync (an event's `block_height` disagreeing with its own transaction's), reporting a new `tx_event_height_desync` block in the report JSON and feeding the overall health verdict. The host health-check script gains a second, CRITICAL-tier check on canonical tip progress that re-pages every 30 minutes while ingest stays stalled, instead of a single alert per incident.

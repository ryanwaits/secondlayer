---
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

cap empty-range cursor sentinel at int4 max so the next fetch doesn't 500

The earlier sentinel `Number.MAX_SAFE_INTEGER` overflowed Postgres `integer` (int4) when used as a query parameter against `stream_event_index`, so the very fetch that was supposed to advance past an empty filtered range threw `value "9007199254740991" is out of range for type integer` and pinned the decoder.

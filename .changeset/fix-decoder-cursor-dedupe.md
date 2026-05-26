---
"@secondlayer/indexer": patch
---

Fix L2 decoder wedge: de-dupe decoded events by cursor before the upsert. A reorged height with stale duplicate transactions can produce two events sharing one Streams cursor in a single batch, which fails the `decoded_events` ON CONFLICT upsert ("cannot affect row a second time") and loops the decoder indefinitely. `writeDecodedEvents` now keeps the last occurrence per cursor.

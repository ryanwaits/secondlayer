---
"@secondlayer/shared": minor
---

`vm_events` primary key is now `(block_height, ordinal)`; the `id` column and the redundant `vm_events_block_height_idx` / `vm_events_type_height_idx` indexes are dropped. `VmEventsTable` no longer has `id`. Archived vm rows record `block_height:ordinal` as their id.

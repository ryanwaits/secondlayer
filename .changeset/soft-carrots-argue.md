---
"@secondlayer/sdk": minor
---

Streams: labelled filter maps. Pass `filters: { <label>: { types, contractId, sender, recipient, assetIdentifier } }` to `events.list`, `events.consume`, and `events.subscribe`; the groups OR together in one server-side scan and each event echoes the labels it matched. `consume` pairs it with `on: { <label>: handler }` — every label must be handled, and a label's declared `types` narrows its handler's events so `payload` is typed without an `event_type` guard.

Two unrelated concerns now share one loop, one cursor, and one checkpoint instead of two consume loops. Cursors stay comparable across a label-set change, so labels can be added or dropped between restarts without resetting the checkpoint.

`onBatch` is now optional when `on` handles the page; a `consume` call with neither throws.

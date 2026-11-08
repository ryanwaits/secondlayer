---
"@secondlayer/sdk": minor
---

Consume and walk loops no longer end quietly. `events.consume`, every Index `consume` and every `walk` throw `CURSOR_STALLED` when a page returns rows but the cursor does not move, and the new `CURSOR_REGRESSED` when a page's `next_cursor` is behind the cursor it was read from. A reorg is no longer marked handled when the consumer's cursor cannot be parsed: the loop throws. Bitcoin (`btc:`) and vm (`vm:`) consumers must upgrade to this release to resume on tagged cursors.

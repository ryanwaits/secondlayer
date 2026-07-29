---
"@secondlayer/sdk": minor
---

`index.sbtc.events.consume()` and `index.sbtc.deposits.consume()` — checkpointed consumers over the decoded sBTC peg feed, with the same cursor commit, reorg rewind, and progress context as every other Index loop. Server-side `topic` filtering survives pagination, so mirroring one topic no longer means pulling all six.

Previously the peg surface offered only `list` and `walk`. Neither checkpoints and neither handles reorgs, so building a durable sBTC index meant dropping to `events.consume({ eventType: "print" })` against the registry contract and filtering topics client-side — giving up the typed columns.

`withdrawals` deliberately has no `consume`: the row is a lifecycle aggregate keyed by `request_id` that mutates as a peg-out moves REQUESTED → ACCEPTED/REJECTED, and a forward-only cursor would commit it once and never see it transition. Consume the append-only `events` feed and derive status from the `withdrawal-*` topics.

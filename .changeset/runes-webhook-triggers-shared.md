---
"@secondlayer/shared": minor
---

Adds Runes chain-trigger types (`rune_etch`, `rune_mint`, `rune_transfer`, `rune_burn`) and matching `trigger.*` builders to the webhooks schema, a `RuneApplyEnvelope`/`RuneApplyDeliveryOf` webhook-delivery shape, `bitcoin_last_cursor` on `trigger_evaluator_state`, and `chain=bitcoin` Streams methods (`getBitcoinStreamsTip`, `getBitcoinStreamsEventsPage`, `listReorgs(since, chain)`) on `IndexHttpClient`.

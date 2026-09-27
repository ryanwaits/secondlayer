---
"@secondlayer/sdk": minor
---

Adds `chain: "bitcoin"` to `streams.events.list`, typed so `types` narrows to the Runes event vocabulary (`rune_etch`/`rune_mint`/`rune_transfer`/`rune_burn`) and rejects a Stacks type at compile time. Also threads `chain`/`rune`/`address` through `stream`/`subscribe`/`consume`, and adds a `chain` option to `tip`, `canonical`, `blocks.events` and `events.byTxId`.

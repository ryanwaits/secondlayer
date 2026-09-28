---
"@secondlayer/sdk": minor
---

Adds `sl.index.runes`: `list`/`get` for the etch catalog, `balances` for current per-outpoint balances (exactly one of `address`/`outpoint`, enforced at the type level), and `activity.list`/`activity.walk` for the etch/mint/transfer/burn event log. Every `rune` field/param takes a `RuneRef` (an id or a name, spacers and case ignored). Same envelope, cursor, and consume conventions as every other Index feed, on a Bitcoin tip instead of a Stacks one.

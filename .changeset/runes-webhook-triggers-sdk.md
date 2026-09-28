---
"@secondlayer/sdk": minor
---

Re-exports `RuneApplyEnvelope`/`RuneApplyDeliveryOf`, so `decodeChainWebhook` narrows a `chain.rune_*.apply` delivery the same way it does every Stacks trigger. `trigger.runeEtch`/`runeMint`/`runeTransfer`/`runeBurn` builders come along via the existing `trigger` re-export.

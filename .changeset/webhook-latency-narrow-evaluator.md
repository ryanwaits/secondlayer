---
"@secondlayer/subgraphs": patch
---

Two fixes. The chain-trigger evaluator's tip fetch now passes its own referenced event types through to `getIndexTip`, so its `wait` is scoped to the decoders it actually reads instead of the global cross-decoder floor — an unrelated decoder committing (any of ~15, several times a block) no longer flips the evaluator's wait to "non-empty" early. Separately, the webhook emitter's claim cycle now re-drains when a NOTIFY arrives while it's already dispatching a batch, instead of dropping that wake: rows inserted mid-drain (a normal burst of matches from one block) used to sit `pending` until an unrelated future wake or the 2-minute safety poll. Added `emitter_claim` info logs (trigger, claimed count, oldest row age, in-flight/concurrency) for diagnosing delivery latency going forward.

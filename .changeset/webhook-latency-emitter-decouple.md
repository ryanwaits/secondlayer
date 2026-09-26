---
"@secondlayer/subgraphs": patch
---

Two emitter fixes. Claiming a batch no longer waits for every sub's dispatch to finish before the next claim can run — a slow or hanging receiver on one webhook used to hold the process-wide claim lock for as long as its own delivery took, starving every other webhook's (and its own future) claims; each webhook now drains from its own persistent queue at its own pace. A row claimed for a webhook that turns out to be paused is now released immediately (unlocked, re-claimable now) instead of being abandoned with its lock held for up to `LOCK_WINDOW_MS`; resuming a webhook also now triggers an immediate claim, so its backlog drains right away instead of waiting on an unrelated NOTIFY or the safety poll. The `emitter_claim` log gains `dispatched`/`released` counts.

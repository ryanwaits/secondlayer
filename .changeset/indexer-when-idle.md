---
"@secondlayer/indexer": patch
---

Catch-up `whenIdle()` no longer resolves from a drain pass that started before the caller registered, so a waiter always sees the block that woke it applied.

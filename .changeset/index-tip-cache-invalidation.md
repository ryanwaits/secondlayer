---
"@secondlayer/api": patch
---

Fixes a hosted-webhook p95 tail: the Index tip cache (500ms TTL) wasn't invalidated on the `index:tip` NOTIFY it's woken by, so a long-poll woken by a commit could re-check and still see the pre-commit cached tip, then hold until the next block. Adds `startIndexTipInvalidationListener` (same pattern as the Streams tip) and a generation check in `longPollIndex`/`waitForIndexTipAdvance` that closes the remaining check-then-wait race.

---
"@secondlayer/indexer": patch
---

`export-snapshot` and `publish-status` now bound their database shutdown and exit explicitly after printing their result, instead of relying on `await closeDb()` to resolve on its own. Fixes a hang observed 2026-09-28: the export sat idle for 20 minutes after finishing, stuck in that call, until the wrapper's own 6-hour timeout killed it.

---
"@secondlayer/sdk": major
---

Remove the overdue deprecations. `onBatch` is now `(events, ctx)` on every consume and replay handler, with `ctx.tip` typed per surface. The 22 storage-shape decoder helpers leave the root and `./streams` entry points (use `./streams/rows` or `decode`). `StreamsBatchContext` and the archive client's `apiKey` option are gone.

---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": patch
"@secondlayer/worker": patch
"@secondlayer/api": patch
---

Surface the chain/control DB split state so its dormancy in prod is visible, not silent: add `getDbSplitStatus()` (source/target host+db, no credentials) exposed on the API `/status` and `/public/status` responses; extend `assertDbSplit()` to warn on a dormant single-failure-domain in prod and error when a split var is unset with no `DATABASE_URL` fallback (the silent wrong-DB case); wire `assertDbSplit()` into the worker and subgraph-processor entrypoints
</content>

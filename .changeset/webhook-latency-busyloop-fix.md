---
"@secondlayer/api": patch
---

Fixes a prod regression from the `wait` long-poll shipping in the last release: `/v1/index/blocks` judged "anything new" by raw row presence, which tracks the ingest tip, not the decoded tip `IndexHttpClient.getIndexTip()` callers (like the hosted chain-webhook evaluator) actually poll against — so `wait` returned almost instantly and the evaluator re-armed in a tight loop instead of holding. `/v1/index/blocks` now accepts `tip_only=true`, which skips the row query and judges emptiness against the tip field directly.

---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": patch
---

Contract discovery takes `classified_after` and returns each contract's `classified_at`. Hosted trait-scoped webhooks and subgraph sources download a trait's contract list once and then fetch only newly classified contracts, instead of the whole list every block.

---
"@secondlayer/subgraphs": patch
"@secondlayer/shared": patch
---

The subgraph processor no longer holds `SECONDLAYER_SECRETS_KEY` — it runs untrusted handler code in-process every block, and production has zero BYO subgraphs, so the one decrypt path the key served never executes; a BYO row without a resolvable key now fails loud with `ByoKeyUnavailableError` instead of falling back to the managed DB

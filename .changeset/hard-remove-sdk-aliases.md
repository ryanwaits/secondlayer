---
"@secondlayer/sdk": major
---

Remove the deprecated client method aliases. Each call has one name.

- `subscriptions.recentDeliveries(id)` → `subscriptions.deliveries(id)`
- `subscriptions.requeueDead(id, outboxId)` → `subscriptions.requeue(id, outboxId)`
- `subgraphs.get(name)` → `subgraphs.status(name)`

Only the subgraphs client renames — `subscriptions.get()`, `contracts.get()`, and the standalone `getSubgraph()` export are untouched.

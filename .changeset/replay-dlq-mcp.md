---
"@secondlayer/subgraphs": minor
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
---

Replay + DLQ + MCP subscription tools.

- `@secondlayer/subgraphs`: new `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` re-enqueues historical rows as outbox entries marked `is_replay=TRUE`. Emitter claims batches 90/10 live vs replay so replays never starve live deliveries.
- `@secondlayer/sdk`: `sl.subscriptions.replay(id, range)`, `recentDeliveries(id)`, `dead(id)`, `requeueDead(id, outboxId)`.
- `@secondlayer/mcp`: 7 new subscription tools — `subscriptions_list|get|create|update|delete|replay|recent_deliveries`. Restart MCP clients after upgrade so the tool cache refreshes.
- Dashboard subscription detail: replay dialog (block range prompt) + DLQ tab listing dead rows with one-click requeue.
- API: `POST /api/subscriptions/:id/replay`, `GET .../dead`, `POST .../dead/:outboxId/requeue`.

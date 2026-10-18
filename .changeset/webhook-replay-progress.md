---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": minor
"@secondlayer/api": minor
---

Webhook replays are recorded with live progress (`GET /api/webhooks/{id}/replays/{replay_id}`, recent replays account-wide), outbox rows carry their replay id, the one-replay-at-a-time check holds across processes, and dead events can be requeued in one call by webhook, by replay, or since a time.

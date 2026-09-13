---
"@secondlayer/cli": minor
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
"@secondlayer/api": minor
"@secondlayer/subgraphs": patch
"@secondlayer/shared": patch
---

Webhooks is the product name for what was Subscriptions. `secondlayer webhooks`, `sl.webhooks`, `webhooks_*` MCP tools and `/api/webhooks` are canonical; the old names keep working for one release cycle and print a deprecation notice. Test-ping deliveries carry `webhook_id`; `subscription_id` is still sent this cycle.

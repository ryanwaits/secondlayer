---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
"@secondlayer/subgraphs": minor
---

Ranked insights for webhooks, subgraphs and the account: a shared `Insight` schema and rules, the `insights` and `insight_mutes` tables, and a leader-elected evaluator in the webhook service. The webhook doctor thresholds now live in `@secondlayer/shared/insights/thresholds`, so the CLI doctor and the server rules share one set of numbers.

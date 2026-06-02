---
"@secondlayer/mcp": minor
---

Add a live `secondlayer://context` resource so a connecting agent learns what exists (its subgraphs + freshness, subscriptions, account/plan), what it can do (the product surfaces and their key tools), and the per-product read-auth tiers. Every live call degrades gracefully when keyless, so the resource never throws.

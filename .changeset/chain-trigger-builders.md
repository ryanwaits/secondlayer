---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
"@secondlayer/mcp": minor
---

feat: `trigger.*` chain-subscription builders + MCP chain support

Expose ergonomic chain-trigger builders for direct chain-level subscriptions from the SDK root, and let the MCP `subscriptions_create` tool create chain subscriptions.

- SDK now exports `trigger` (`import { trigger } from "@secondlayer/sdk"`) with one builder per event type (`trigger.contractCall`, `trigger.ftTransfer`, …), plus the `ChainTrigger` / `SubscriptionKind` types. Use as `subscriptions.create({ triggers: [trigger.contractCall({ ... })] })`. Raw `triggers` objects still work. (Renamed from the previously-unreachable `on` export to avoid colliding with `@secondlayer/stacks`'s subgraph-source `on`.)
- MCP `subscriptions_create` accepts a `triggers` array (chain subscription) as an alternative to `subgraphName`/`tableName` (subgraph subscription).

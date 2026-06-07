---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
"@secondlayer/shared": minor
---

Subscriptions agent parity: expose `authConfig` (bearer receiver auth) on `subscriptions_create`/`subscriptions_update`, `name` (rename) on `subscriptions_update`, and `force` (idempotency suffix to re-run an already-replayed range) on `subscriptions_replay` + the SDK `replay()`. Add `CHAIN_TRIGGER_FIELDS` (derived from `ChainTriggerSchema`, never drifts) in shared and a `secondlayer://chain-triggers` MCP resource listing the filter fields each chain-trigger type accepts.

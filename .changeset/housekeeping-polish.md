---
"@secondlayer/api": patch
"@secondlayer/cli": minor
"@secondlayer/subgraphs": patch
---

Housekeeping polish:

- Dropped fictitious typed-key prefixes (`sk-sl_streams_…`, `sk-sl_index_…`) from marketing copy + sandbox placeholder. Real keys are generic `sk-sl_…`; scoped prefixes were doc fiction.
- Index rate-limit 429 for free tier now returns `{required_tier, upgrade_url}` so blocked users know how to unblock.
- `sl subgraphs status <name> --watch` polls every 2s, clearing screen between snapshots, exits cleanly when synced.
- `standard-webhooks.ts` docstring clarified that only `.created` is emitted in v1; `.updated`/`.deleted` are deferred.
- T8.6 `sl subgraphs logs` deferred — needs server-side log storage.
- T8.3 broken tenant URL strip is `[infra]`, tracked in ops backlog.

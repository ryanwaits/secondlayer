---
"@secondlayer/subgraphs": patch
---

Emit subgraph subscription webhooks for updates and deletes, not just inserts. `emitSubscriptionOutbox` previously skipped any flush write whose op wasn't `insert` and hardcoded the event type to `.created`, so a receiver tracking a mutable row saw it appear then went silent on every transition. The op now maps to a lifecycle verb — `insert → .created`, `update → .updated`, `delete → .deleted` — while the dedup-key format is unchanged so existing `.created` rows stay idempotent across replays.

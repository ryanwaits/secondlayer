---
"@secondlayer/sdk": patch
---

`SbtcEventTopic` and `IndexPox5EventTopic` are no longer hand-retyped copies — they re-export the canonical constants from `@secondlayer/stacks/sbtc` and `@secondlayer/stacks/pox5` (byte-identical today; now they can never drift). A new type-level CI gate also pins that `@secondlayer/stacks/filters` projections stay assignable to this SDK's Index/Streams/Subscriptions param types.

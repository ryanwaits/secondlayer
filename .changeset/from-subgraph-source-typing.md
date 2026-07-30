---
"@secondlayer/stacks": patch
---

`fromSubgraphSource` now returns `ChainEventFilter<SubgraphMemberType>` (the non-sBTC members), so `toSubgraphSource()` and the other projections are visible on its result — previously the full-union instantiation collapsed the conditional projection methods and the round-trip failed to typecheck. New `SubgraphMemberType` / `SubgraphSourceSpec` exports.

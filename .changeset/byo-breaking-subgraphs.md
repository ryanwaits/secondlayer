---
"@secondlayer/subgraphs": minor
---

Carry a structured migration plan on a refused BYO breaking-change deploy: `renderDeployPlan` now emits `dropStatement`, and the refuse path throws a typed `ByoBreakingChangeError` exposing `reasons`, `diff`, and the DROP + rebuild DDL.

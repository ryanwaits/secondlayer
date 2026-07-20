---
"@secondlayer/api": patch
---

Consolidate duplicated query-param validators (`parseNonNegativeInteger`, `parseCursor`) into a single `parse-query.ts` module shared by the index and streams surfaces. Behavior-preserving; error strings on the frozen /v1 envelope unchanged.

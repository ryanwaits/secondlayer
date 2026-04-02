---
"@secondlayer/subgraphs": minor
"@secondlayer/shared": patch
"@secondlayer/mcp": patch
"@secondlayer/cli": patch
---

feat(subgraphs): named-object sources with SubgraphFilter discriminated union

Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

---
"@secondlayer/subgraphs": minor
"@secondlayer/scaffold": patch
"@secondlayer/bundler": patch
---

Print sources can declare a static `materialize` block (`{ from }` / `fromTx` / `fromBlock`) instead of a handler for 1:1 identity maps. Validate enforces materialize XOR handler, `from` keys ⊆ prints, and table/column existence. Runner and `probeHandlers` desugar materialize to inserts. Print-scaffold emits materialize (no `ctx.insert` handlers) for named topics.

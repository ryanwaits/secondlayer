---
"@secondlayer/subgraphs": minor
---

Add `aggregate(spec)` to the typed subgraph table client. `AggregateSpec`/`AggregateResult` infer the result shape from the spec (count/countDistinct as numbers, sum/min/max as lossless strings). SUM/MIN/MAX are restricted to numeric columns at compile time; the `const` type parameter narrows results without `as const`.

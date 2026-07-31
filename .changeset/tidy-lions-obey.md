---
"@secondlayer/sdk": patch
"@secondlayer/stacks": patch
---

Two silent-wrong-results fixes from the filter-surfaces audit.

`streams.events.stream({ filters })` now actually forwards the labelled OR-groups. The param was declared and the underlying iterator supported it, but the client never passed it through — a caller narrowing with labels got the FULL unfiltered firehose, billed per row, with no error. `list`, `consume`, and `subscribe` were unaffected.

`@secondlayer/stacks`: wildcards inside a `contractId` array are now refused at projection time like scalar wildcards always were. The guard checked only scalar values, so `on.print({ contractId: ["SP….pool-*"] }).toIndexParams()` reached the wire as a literal `IN ('SP….pool-*')` — the silent zero-row match the filter union exists to kill. Subgraph sources keep wildcard support, unchanged.

---
"@secondlayer/subgraphs": minor
---

Type print `event.data` per topic. A `print_event` source can declare a `prints` map (`{ [topic]: { [field]: ColumnType } }`); the handler's `event` then becomes a discriminated union keyed by `topic` with `event.data` typed per topic (same column-type vocab as `schema` — `"uint"` → `bigint`, `"principal"` → `string`, nested → `"jsonb"`). Sources without `prints` keep the untyped `Record<string, unknown>` data. Type-level only — no runtime change.

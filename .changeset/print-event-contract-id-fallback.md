---
"@secondlayer/subgraphs": patch
---

Match `print_event` sources whose payload stores the contract under `contract_id` (in addition to `contract_identifier`). Mirrors the streams query's dual-shape lookup. Without this, every `print_event` subgraph with a `contractId` filter silently indexed 0 rows for the newer `contract_event` payload shape.

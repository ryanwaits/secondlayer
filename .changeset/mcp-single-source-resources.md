---
"@secondlayer/mcp": patch
---

Single-source the `secondlayer://column-types` and `secondlayer://filters` resources from the subgraphs vocab so they can't drift behind the validator. Fixes drifted entries that made agents emit validator-rejected schemas: column types now report `NUMERIC`/`boolean`/`jsonb`/`timestamp` (was `bigint`/`bool`/`json`, `timestamp` missing); filter fields now match `SubgraphFilter` (e.g. `contract_call` → `contractId`/`functionName`/`caller`, `print_event` drops the unsupported `contains`, NFT filters drop the unsupported `tokenId`). Drift tests lock both to `TYPE_MAP` / `SubgraphFilterSchema`.

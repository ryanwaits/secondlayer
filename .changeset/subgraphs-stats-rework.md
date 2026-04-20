---
"@secondlayer/subgraphs": patch
---

Drop `api_key_id` from runtime `StatsAccumulator` + catchup/reindex — the subgraphs table's `api_key_id` column was removed in the shared-tenancy cutover (migration 0041).

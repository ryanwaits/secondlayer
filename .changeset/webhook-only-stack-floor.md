---
"@secondlayer/workload": minor
"@secondlayer/platform": minor
---

A webhook-only hosted stack no longer runs `subgraph-processor` (compose profile `subgraphs`, reconciled each tick and right after a deploy from the tenant's own subgraph count into `tenants.has_subgraphs`) and bills a $5/mo memory floor; a stack with subgraphs bills $10/mo. Floors are set in dollars (`STACK_FLOOR_USD_MICROS_PER_MONTH`) and the GB floor is derived from the memory rate. Tenant Postgres drops to `shared_buffers=16MB`.

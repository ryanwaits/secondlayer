---
"@secondlayer/shared": major
"@secondlayer/provisioner": minor
---

Cutover to dedicated-only. Shared-tenancy subgraph code + infra removed now that every customer runs on per-tenant `sl-{role}-<slug>` containers.

- **Breaking (shared)**: migration `0041` drops `subgraphs.api_key_id`. Schema-level uniqueness restored to `UNIQUE (name)` (previously scoped via `(api_key_id, name)` partial indexes). Tenant DBs already had `NULL api_key_id` — safe.
- **Breaking (api)**: `/api/subgraphs` + `/api/node` stop mounting in `INSTANCE_MODE=platform`. Platform API is a pure control plane: accounts, projects, sessions, tenants, auth, marketplace, admin. Subgraph queries must hit the tenant URL (`https://{slug}.{BASE_DOMAIN}/api/subgraphs`).
- **Breaking (api)**: `assertSubgraphOwnership` now a thin DB read — every remaining caller already proved tenant-membership via JWT/static-key middleware.
- `pgSchemaName(name, accountPrefix?)` → `pgSchemaName(name)`. Tenant DBs are self-contained — no prefix disambiguation.
- Admin stats endpoint returns tenant counts (`totalTenants`, `activeTenants`, `suspendedTenants`) in place of the old subgraph counts.
- Worker `measureStorage` cron skips in platform mode (per-tenant measurement is the provisioner's job).
- Infra: `subgraph-processor` service + hetzner volume override removed from compose; `deploy.sh` includes `--profile platform` so provisioner picks up compose changes without manual recreate.

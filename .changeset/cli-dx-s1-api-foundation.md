---
"@secondlayer/shared": minor
---

CLI DX rework, Sprint 1 (backend foundation):

- Migration `0042_tenant_project_id` — adds `tenants.project_id uuid REFERENCES projects(id) ON DELETE SET NULL` + index. Supports `1 project : 1 tenant` today, `1 project : N tenants` later.
- `TenantsTable.project_id` added to types. `insertTenant` accepts optional `projectId`.
- No migration of existing tenant rows — `project_id = NULL` is legal (legacy tenants provisioned via `POST /api/tenants`). New provisions via `POST /api/projects/:slug/instance` populate it.

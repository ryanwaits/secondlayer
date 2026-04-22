---
"@secondlayer/shared": minor
"@secondlayer/provisioner": minor
---

Pricing Sprint C.1 — decouple compute from plan for add-ons.

- Migration 0048 adds `tenant_compute_addons` table. Each row = one add-on bundle (memory/cpu/storage deltas with optional effective window + Stripe subscription_item_id). Effective compute = plan base + SUM(active deltas).
- New `@secondlayer/shared/db/queries/tenant-compute-addons` module: `listActiveAddonsForTenant`, `computeEffectiveCompute(tenantId, base)`.
- `@secondlayer/provisioner` breaking changes:
  - `resizeTenant(slug, planId)` → `resizeTenant(slug, { plan, totalCpus, totalMemoryMb, storageLimitMb })`. Plan stays as a label; sizing is explicit.
  - `getTenantStatus(slug, plan)` → `getTenantStatus(slug, plan, storageLimitMb)`. Caller passes the effective storage limit from the tenants row.
  - `rotateTenantKeys` preserves existing container sizing by reading from `docker inspect` instead of recomputing from the plan — so it stays correct for tenants with add-ons.
  - `POST /tenants/:slug/resize` body shape: `{ plan, totalCpus, totalMemoryMb, storageLimitMb }`.
  - `GET /tenants/:slug` now reads `storageLimitMb` query param.
- New exported `allocForTotals(totalMemoryMb, totalCpus)` from `packages/provisioner/src/plans.ts` — auto-biases to PG-heavy split below 1 GB, default split above.
- Platform API `POST /api/tenants/me/resize` now composes plan base + active add-ons via `computeEffectiveCompute` before calling the provisioner. `tenants.cpus/memory_mb/storage_limit_mb` cache the effective values for dashboard + billing.
- Add-on CRUD + Stripe wiring land in Sprint C.2/C.3; this sprint is data-model + plumbing only.

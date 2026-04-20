---
"@secondlayer/provisioner": minor
"@secondlayer/shared": minor
---

Phase 1 instance-page hardening. Adds per-tenant key rotation with independent service/anon generations, suspend/resume endpoints on the provisioner, hard-delete teardown, typed provisioner errors, and automatic attachment of the platform postgres to `sl-source` with a `postgres` alias at provision time.

- `jwt.ts` — `mintTenantKeys` now takes `{ serviceGen, anonGen }` and embeds a `gen` claim; adds `mintSingleKey` for role-scoped rotation.
- `lifecycle.ts` — new `rotateTenantKeys(slug, plan, type, newGens)` recreates the tenant API container with new env vars and mints replacement key(s).
- `routes.ts` — adds `POST /tenants/:slug/keys/rotate`; bubbles typed error codes + appropriate HTTP status via new `httpStatusForProvisionError`.
- `types.ts` — adds `ProvisionErrorCode`, `classifyProvisionError`, `httpStatusForProvisionError`.
- `docker.ts` — adds `networkConnectWithAlias` (idempotent); `provision.ts` calls it to attach `secondlayer-postgres-1` to `sl-source` as `postgres` so fresh Hetzner hosts work without manual compose edits.
- `@secondlayer/shared` — migration `0040_tenant_key_generations` adds `service_gen` + `anon_gen` counters to `tenants`; new queries `bumpTenantKeyGen`, `updateTenantKeys`, `deleteTenant`.
- `@secondlayer/api` middleware — `dedicatedAuth` validates the `gen` claim against `SERVICE_GEN`/`ANON_GEN` env; adds `/me/keys/rotate`, `/me/suspend`, `/me/resume`; changes `DELETE /me` from soft-suspend to hard-delete (containers + volume + DB row).

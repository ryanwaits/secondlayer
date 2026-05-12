---
"@secondlayer/sdk": patch
---

auto-resolve tenant baseUrl for subgraphs + subscriptions; expose `ApiError.code`. previously `sl.subgraphs.list()` and `sl.subscriptions.list()` 404'd on the documented default `baseUrl` because those routes don't run on the platform api — they live on per-tenant containers. the SDK now lazily resolves the tenant url via `/api/tenants/me` on first tenant-resource call, caches it, and routes requests there. opt-out via `tenantBaseUrl` constructor option (OSS / staging / custom routing). `ApiError` gains a `code` field populated from the api's `{error, code}` envelope so callers don't have to dig into `err.body` for `VALIDATION_ERROR`, `NOT_FOUND`, etc. distinctive codes for tenant resolution failures: `TENANT_SUSPENDED`, `NO_TENANT`.

---
"@secondlayer/cli": patch
---

fix `sl subgraphs deploy` returning 404 Not Found against tenants on SDK 3.5.4+. The CLI mints its own ephemeral JWT via `resolveActiveTenant()` and hands it to the SDK, but the SDK's new `requestAtTenant()` tries to re-mint a token against its `baseUrl` — which the CLI was setting to the tenant URL, where `/api/tenants/me/keys/mint-ephemeral` doesn't exist. Now uses the SDK's `tenantBaseUrl` constructor option (added in 3.5.4 for this exact case) to short-circuit the resolver. Bumps SDK dep `^3.3.2 → ^3.5.4`.

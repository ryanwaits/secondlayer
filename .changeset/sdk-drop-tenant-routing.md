---
"@secondlayer/sdk": minor
---

Drop tenant URL auto-resolution and ephemeral JWT minting. Subgraphs and subscriptions now route through the platform API alongside Streams and Index — pass your `sk-sl_*` key as `apiKey` and the SDK uses it directly. Removed: `tenantBaseUrl` constructor option, `requestAtTenant`/`requestTextAtTenant`, `getTenantSession`, `getTenantBaseUrl`, `mintTenantSession`, `MintEphemeralResponse`/`TenantSession` types.

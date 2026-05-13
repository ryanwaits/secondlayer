---
"@secondlayer/sdk": patch
---

fix subgraphs + subscriptions returning "Malformed JWT" 401 on tenant URLs. SDK 3.5.3's auto-resolve landed on the right tenant URL but kept sending the platform `sk-sl_*` key as Bearer — tenant containers expect a short-lived HS256 JWT. SDK now mints an ephemeral JWT via `POST /api/tenants/me/keys/mint-ephemeral` on first tenant call (which returns both `apiUrl` + `serviceKey` in one round-trip, replacing the previous `/api/tenants/me` resolver), caches the session, and refreshes 30 s before the 5-min TTL expires. `tenantBaseUrl` constructor option still bypasses the mint flow for OSS / staging setups where the same `apiKey` works against both surfaces.

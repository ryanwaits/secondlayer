---
"@secondlayer/mcp": minor
"@secondlayer/shared": minor
"@secondlayer/platform": minor
"@secondlayer/api": minor
"@secondlayer/worker": patch
"@secondlayer/web": minor
---

Hosted MCP at `https://api.secondlayer.tools/mcp` with OAuth browser sign-in. `claude mcp add --transport http secondlayer https://api.secondlayer.tools/mcp` gets a 401 naming `/.well-known/oauth-protected-resource/mcp`, registers the client (DCR, public clients only), and the person signs in and allows it on the new `/oauth/consent` page. Tokens are `oat-sl_` (1 h) and `ort-sl_` (30 days, rotated, a reused one revokes the grant), stored as hashes, PKCE S256 only, exact redirect matching. An access token works only on the MCP handler's own in-process requests, so `/v1` and `/api` refuse it. An `sk-sl_` key also works as the bearer.

- `@secondlayer/mcp`: `createServer({ hosted, clientProvider, archiveOpsClientProvider, apiRequest })` takes injected credentials; `hosted: true` registers only the hosted tool set (Index, Streams, Contracts, `subgraphs_scaffold`, `account_whoami`). Each tool group declares `hosted`. `createApiRequest` is exported. The stdio and self-host servers are unchanged.
- `@secondlayer/shared`: migration `0177_oauth_mcp` adds `oauth_clients`, `oauth_requests`, `oauth_codes`, `oauth_grants`, `oauth_tokens` and `oauth_refresh_retired` (control plane).
- `@secondlayer/platform`: `db/queries/oauth`, the token store (mint, exchange, rotate, revoke, purge) with every lifetime in one place.
- `@secondlayer/api`: `/.well-known/oauth-*`, `/oauth/register|authorize|token`, `POST /mcp`, and session-only `/api/oauth/requests/:id` (approve, deny) and `/api/oauth/grants` (list, revoke).
- `@secondlayer/worker`: hourly purge of expired OAuth rows.
- `@secondlayer/web`: the consent page, and an Apps section on the Keys tab with Revoke. `/docs/mcp` leads with the hosted URL.

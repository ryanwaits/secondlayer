---
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/mcp": patch
---

One account credential resolver across the CLI and MCP server: `resolveIdentity` and `resolveAccountUrl` are exported from the SDK. When both `SECONDLAYER_API_KEY` and a saved `secondlayer login` session exist, the key now wins everywhere. Previously credits, keys and `whoami` preferred the session while webhooks and subgraphs preferred the key, so one terminal could act on two accounts. Unset the key to act as the logged-in account. `login`, `logout`, `keys` and every authed command now share one session slot keyed by the account URL; a session saved under another hosted URL is adopted into it on first read and the old entry is left in place. The MCP server reads the account URL from `SL_CREDITS_API_URL` (or the older `ARCHIVE_OPS_API_URL`), the same as the CLI.

`secondlayer subgraphs dev` no longer overlaps deploys: saves during a deploy collapse into one re-run after it settles. `secondlayer subgraphs status --watch` now exits non-zero with the reason when the subgraph is in `error` or paused for billing, instead of polling forever.

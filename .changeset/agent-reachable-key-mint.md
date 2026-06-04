---
"@secondlayer/api": minor
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/mcp": minor
---

Agent-reachable, hardened API-key mint. A headless agent holding an account-level (owner) key can now self-provision a SCOPED `streams`/`index` read key via `POST /v1/api-keys` — no dashboard. The minted key is always scoped (never an account/superkey), inherits the account plan's tier, is per-IP rate limited, and is bounded by a per-account active-key ceiling. Surfaced as `sl.apiKeys.create()` (SDK), `sl keys create` (CLI), and the `account_create_key` MCP tool.

Also closes a privilege-escalation hole on the existing `POST /api/keys`: it accepted any valid credential and did no product check, so a leaked scoped key could mint an account superkey. Minting is now owner-gated (a dashboard session or an `account`-product key), and non-session callers are confined to scoped keys with an inherited tier.

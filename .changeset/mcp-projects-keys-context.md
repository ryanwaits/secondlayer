---
"@secondlayer/mcp": minor
---

Add full project CRUD tools (`project_list`/`get`/`create`/`update`/`delete`/`team_list`), complete the API-key lifecycle (`account_list_keys`/`account_revoke_key` alongside the existing mint), and add `account_usage`/`account_get_caps`/`account_set_caps` so an agent can read its usage and bound its own spend (no Stripe — payment flows stay session-only). The `secondlayer://context` resource now lists the account's projects and API keys so agents see their own inventory before acting.

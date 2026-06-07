---
"@secondlayer/mcp": patch
---

Document two agent paths in tool descriptions: `subgraphs_query` now explains the `_id`-cursor tail pattern (`sort=_id`, then poll `{"_id.gt": last}`) as the request/response substitute for SSE streaming, and fetch-by-id via `{"_id": ...}`. `account_billing` notes that plan upgrade / Stripe portal / checkout are deliberately session-only human-payment flows (not agent tools) — use `account_set_caps` to bound spend.

---
"@secondlayer/cli": patch
---

Documents `resolveHostedAuth()`'s credential resolution order in the README's Auth section: `SECONDLAYER_API_KEY`, then `INSTANCE_TOKEN`/`--api-key`, then a saved `secondlayer login` session (`~/.secondlayer/session.json`). Explains a report of `webhooks list` succeeding against the merchant host with no `SECONDLAYER_API_KEY` set — a saved session from an earlier login, a real credential, not a missing-auth bug.

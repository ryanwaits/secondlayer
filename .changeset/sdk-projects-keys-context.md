---
"@secondlayer/sdk": minor
---

Add a `projects` client (`list`/`get`/`create`/`update`/`delete`/`team`) for full project CRUD, and extend `apiKeys` with `list()` (metadata only — never the plaintext) and `revoke(id)` to complete the API-key lifecycle. The `context()` snapshot now includes `projects` and `apiKeys` so agents can see their own inventory before acting.

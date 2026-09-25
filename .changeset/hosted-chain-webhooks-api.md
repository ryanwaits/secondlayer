---
"@secondlayer/api": minor
---

`POST /internal/keys/introspect`: resolves a presented `sk-sl_*` account key to `{account_id, credits_ok}` for the hosted workload host's gateway, guarded by the same `WORKLOAD_HOST_KEY` bearer `/internal/meters` uses. Platform mode only; 404 on self-host.

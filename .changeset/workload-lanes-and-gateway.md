---
"@secondlayer/workload": patch
---

Gateway rejects forward URLs off the tenant origin and strips Set-Cookie and hop-by-hop headers. Tenant memory is sampled with one docker stats call per tick. Provision, upgrade and processor reconcile run in the account lane; a provision that loses to a destroy tears its containers down.

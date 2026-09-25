---
"@secondlayer/workload": patch
---

Tenant stacks now follow every prod deploy automatically. The host polls app-server's `/health` for the deployed image sha every 5 minutes and rolls stale `running` tenants forward one at a time (pull, then up, recording what each tenant runs); a failed pull or a failed health-check on the new containers stops the round and rolls that tenant back to its previous sha. `WORKLOAD_IMAGE_TAG` is no longer a required env var on the workload host — the provisioner resolves and supplies it per compose call instead.

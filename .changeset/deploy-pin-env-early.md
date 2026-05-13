---
"@secondlayer/api": patch
---

fix deploy.sh leaving prod in mixed-version state when wait-for-healthy fails. Previously `.env` was only updated by `record_successful_deploy()` at end-of-script — a failed health check meant new containers were running but `.env` still pointed at the OLD tag, causing any subsequent manual `docker compose up -d <service>` to silently roll the service back. Now pins `.env` immediately after `docker compose up -d`, separate from the state-dir markers in `record_successful_deploy()`. State-dir markers still only update on full success — they represent "last verified good deploy" (separate concept from "what's running now").

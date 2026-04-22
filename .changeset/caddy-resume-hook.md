---
"@secondlayer/provisioner": patch
---

Auto-resume paused Hobby tenants on direct-API traffic.

- New `POST /internal/resume/:slug` on the provisioner. Kicks off an async `resumeTenant` for suspended containers and returns `503 Retry-After: 30` so the caller retries after the containers are healthy (~20s). Already-running containers short-circuit to 503 too — next retry lands on the upstream. Unknown slugs → 404. No auth; same internal-network gating as `/internal/caddy/ask`.
- Caddyfile gains a `handle_errors` block on the wildcard tenant route that proxies upstream dial failures (502/503/504) to the resume endpoint. Idempotent; duplicate resume calls cost nothing. Completes the Hobby resume story: dashboard had a button, CLI had mint-ephemeral transparent resume, direct-API callers now auto-resume too.

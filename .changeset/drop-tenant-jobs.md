---
"@secondlayer/api": patch
---

Delete the dedicated-mode `trackTenantActivity` middleware and `/internal/activity` endpoint. The worker cron that consumed them is gone post shared-rip; nothing reads `getLastRequestAtMs` anymore.

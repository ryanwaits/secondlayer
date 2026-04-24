---
"@secondlayer/shared": patch
---

Diagnostic: Kysely `log` hook logs failing SQL + params whenever postgres rejects with code 42P10 (ON CONFLICT target doesn't match a unique constraint). Temporary — will be reverted in a follow-up patch once the culprit query is identified in prod logs.

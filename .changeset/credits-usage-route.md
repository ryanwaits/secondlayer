---
"@secondlayer/web": patch
---

Added the missing `GET /api/billing/usage` route the credits page's `refreshUsage` was calling — it 404'd (only `topup`/`status` existed), so the Usage panel rendered nothing even with real usage. The panel now also tells "not loaded yet" apart from "load failed" and shows a retry instead of staying blank.

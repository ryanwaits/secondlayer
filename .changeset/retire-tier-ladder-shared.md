---
"@secondlayer/shared": patch
---

Fix the stale `platform` mode docblock in `mode.ts` — it still described projects/admin, which were deleted; now describes what platform mode actually serves (accounts, credits, metered `/v1` reads).

---
"@secondlayer/sdk": patch
---

Collapse the duplicated 404→null try/catch in `get*` accessors into a single `BaseClient.requestOrNull` helper (no behavior change).

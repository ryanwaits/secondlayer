---
"@secondlayer/cli": patch
---

Point subgraph deploy and ABI-fetch 401s at real next steps.

Deploy now uses the same `handleApiError` path as list/status/query/delete.
Scaffold/codegen no longer tell you to run `secondlayer auth login`.

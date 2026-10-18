---
"@secondlayer/platform": patch
"@secondlayer/api": patch
"@secondlayer/web": patch
---

Sentinel's check meter: `sentinel.check_run` is $0.25 a check ($0.75 for a deep check, quantity 3), accepted on `/internal/meters` and `/internal/sentinel/affordable` (short name `check_run`). `sentinel.run` and `sentinel.deep_audit` are retired: `/internal/meters` refuses new charges on them with a 400, and their prices stay so existing ledger rows still price and render.

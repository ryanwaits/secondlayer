---
"@secondlayer/api": patch
---

`/internal/sentinel/accounts/summary` returns only the current Sentinel prices (`check_run`, `monitored_event`). The retired `run` and `deep_audit` prices are gone from the summary; they still price old ledger rows.

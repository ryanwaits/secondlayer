---
"@secondlayer/shared": minor
---

Webhook replay, update subscriber, CLI device login and feedback ticket statuses are const arrays with transition machines; replay scan, finish, fail, finalize and restart go through `casTransition`. The unset `DATABASE_URL` fallback is now the repo dev compose (`postgresql://postgres:postgres@127.0.0.1:5440/secondlayer`). Contract state rows are indexed by contract for long-range reads.

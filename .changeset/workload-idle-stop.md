---
"@secondlayer/workload": minor
---

A hosted stack with no active webhooks and no subgraphs stops on its own (5-minute poll, never within 15 minutes of starting, never on an unreadable count) and starts again on its next request. Stopped tenants record why (`credits`, `cap` or `idle`); the poll restarts only credit and cap stops once the account is ok.

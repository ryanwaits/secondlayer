---
"@secondlayer/shared": patch
"@secondlayer/sdk": patch
"@secondlayer/api": patch
"@secondlayer/web": patch
---

`WebhookSummary` (the webhooks list) now carries `circuitFailures`, the consecutive failed deliveries a success resets. The dashboard's list page uses it so a row reads Failing, and counts toward "Needs attention", as soon as its receiver fails 5 times in a row, not only once the circuit breaker pauses it.

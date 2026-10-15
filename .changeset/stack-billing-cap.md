---
"@secondlayer/platform": minor
"@secondlayer/api": minor
"@secondlayer/worker": patch
"@secondlayer/shared": patch
---

Hosted stack billing: a memory, storage or webhook charge larger than the balance now drains it to zero (the shortfall is written off) instead of being refused, so a stack can't keep running unbilled on a balance smaller than one charge. The monthly spend cap now covers every unit, not only rows delivered: past it, charges are recorded but not taken, `credits_ok` is false (stopping the hosted stack), and archive fetches answer `402 spend_cap_reached`. `/internal/accounts/credits` answers `{ ok, reason }` per account. Spend-cap emails say the stack stops at the cap.

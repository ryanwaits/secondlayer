---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Add `defineMachine` and `casTransition` (`@secondlayer/shared/db/transition`) for explicit state machines. Contract ABI status, webhook outbox status, API key status and subgraph gap reason now have database CHECK constraints and narrowed column types (`AbiStatus`, `ApiKeyStatus`, `GapReason`).

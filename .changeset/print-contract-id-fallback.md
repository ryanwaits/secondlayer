---
"@secondlayer/subgraphs": patch
---

Print handlers read `event.contractId` from either payload shape (`contract_identifier` or `contract_id`). The matcher already accepted both; the runner now uses the same helper, so a `contract_event` row no longer reaches the handler with an empty contract id.

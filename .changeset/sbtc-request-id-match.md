---
"@secondlayer/subgraphs": patch
---

sBTC withdrawal webhooks filtered by `requestId` now fire: the id was compared as a string. Delivered `request_id` and `block_height` are numbers, as typed.

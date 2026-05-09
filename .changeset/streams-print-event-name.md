---
"@secondlayer/indexer": patch
---

fix(streams): include `contract_event` in print-event mapping

Print events were only mapped from the legacy `smart_contract_event` DB type. The upstream node renamed to `contract_event` around block 7828030 on mainnet, leaving every print-event consumer (BNS decoder, anything else that subscribes via `types: ["print"]`) seeing zero events for the entire post-rename range. The streams events reader now selects both DB labels and treats them identically — same payload shape, same `contract_identifier` resolution.

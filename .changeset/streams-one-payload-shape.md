---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
"@secondlayer/subgraphs": patch
---

Streams events have one payload shape at every height. `print` and nft payloads always carry `raw_value` (`0x` hex; legacy `value` is deprecated and kept only where stored), `stx_transfer.memo` is always `0x` hex or `null` (Index too), and `stx_lock` carries `contract_identifier`, its PoX contract. New `normalizeMemoHex`, `clarityHexOf`, `mainnetPoxContractAt` and `isPoxContractId` helpers. Subgraph `stx_transfer` handlers get `memo` as `0x` hex or `""`.

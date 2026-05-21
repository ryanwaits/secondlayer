---
"@secondlayer/subgraphs": minor
---

Type `contract_call` arguments from the contract ABI. A `contract_call` source can carry a `const` `abi`; the handler then receives `event.input` — the named, decoded function arguments typed from the ABI (camelCase keys, `uint128` → `bigint`, `buff` → `Uint8Array`, tuples/optionals/responses shaped per the ABI). The positional `event.args` is kept for back-compat. Sources without an `abi` are unchanged.

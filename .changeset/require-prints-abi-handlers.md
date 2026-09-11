---
"@secondlayer/subgraphs": minor
"@secondlayer/api": patch
---

Pinned `print_event` sources now require a non-empty `prints` map at validate and in types (trait/unpinned may omit). `contract_call` with `functionName` requires `abi`. Every source needs a handler or `"*"`. TypedHandlers keys are required. Print-field lint comment updated: declared-prints mismatches stay deploy errors; lookup failure still skips.

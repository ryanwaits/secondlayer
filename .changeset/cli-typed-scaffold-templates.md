---
"@secondlayer/cli": patch
---

Scaffold templates now emit typed, cast-free handlers. `contract_call` handlers use the typed `event.functionName`/`event.resultHex` (and note `abi` → `event.input`); `print_event` handlers use the typed `event.topic`/`event.data` and the basic template is a coherent `ft_transfer` example. Matches the typed handlers in `@secondlayer/subgraphs` 3.x.

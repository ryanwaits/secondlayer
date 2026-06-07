---
"@secondlayer/cli": patch
"@secondlayer/scaffold": minor
---

Make generated contract-state readers point at your own node, configurably. Each generated map/var/constant reader now accepts `{ apiUrl }` and honors `STACKS_NODE_RPC_URL`, with precedence `apiUrl > STACKS_NODE_RPC_URL > network default` (the public API default is kept for zero-config use). Repoint the CLI's mainnet/testnet ABI fetch off the platform-dead `/api/node` proxy to the SecondLayer contract registry (`/v1/contracts/:id?include=abi`), which works in prod.

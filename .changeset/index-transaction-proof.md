---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
"@secondlayer/api": patch
---

Add `index.transactions.getProof(txId)` (SDK) and the `index_transaction_proof` MCP tool — fetch a transaction's inclusion proof (raw tx + signed Nakamoto header + merkle path) to verify trustlessly with `verifyTransactionProof`. 404 → null. The proof endpoint now degrades gracefully when the signed-header source (stacks-node) is unreachable: a typed `ProofNodeUnavailableError` → HTTP 503 `PROOF_NODE_UNAVAILABLE` instead of an opaque 500. The api container reads `STACKS_NODE_RPC_URL` (added as a compose env hook, empty by default) — set it to a reachable Nakamoto node to enable proofs in platform/prod.

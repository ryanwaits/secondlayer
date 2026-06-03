---
"@secondlayer/api": patch
---

Fix 500s on /v1/index/transactions, /contract-calls, and /mempool when a decoded contract-call arg/result is a Clarity uint/int (cvToValue yields a BigInt, which throws in JSON.stringify and the ETag). Decoded values are now deep-converted to strings via jsonSafeBigInt.

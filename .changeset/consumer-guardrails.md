---
"@secondlayer/sdk": minor
---

Consumer and client guardrails:

- `fetchImpl` is now honored by every platform client (`index`, `contracts`, `subgraphs`, `subscriptions`, `apiKeys`, `projects`, `batch`, `context`) — previously it was a documented option that was silently ignored, forcing tests to monkey-patch `globalThis.fetch` and blocking x402-wrapped fetches from composing with the typed client.
- `finalizedOnly` consumers now throw a `ValidationError` when `onBatch` returns a cursor above the last delivered finalized event (e.g. `envelope.next_cursor`). Committing past the filtered unfinalized tail silently dropped those events forever; the loop now detects the one wrong return it can detect.
- x402 base64 helpers and proof hex decoding no longer use `Buffer`, so payments and proof verification work on edge runtimes (Workers) where `Buffer` is not defined.

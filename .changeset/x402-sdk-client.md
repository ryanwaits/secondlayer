---
"@secondlayer/sdk": minor
---

Add `@secondlayer/sdk/x402`: a client for the x402 pay-per-request rail. `payAndRetry` runs a request, and on a 402 builds a signed (origin-only, gasless) `PAYMENT-SIGNATURE` from the challenge and retries — one call, no key, no STX. `buildSignedX402Payment`/`readX402Challenge` are exposed for custom flows.

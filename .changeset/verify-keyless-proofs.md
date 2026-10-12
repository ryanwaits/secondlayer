---
"@secondlayer/verify": minor
---

Proofs need no key: `new SecondlayerProofSource()` reads the hosted API anonymously; `apiKey` raises the rate limit and is required only for `rows: true`. Retries 429 after `retry-after`. Runs in browsers.

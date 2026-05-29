---
"@secondlayer/sdk": minor
---

`createStreamsClient` gains an optional `verify` hook (default off): pass `true` to fetch the server's ed25519 public key, or `{ publicKey }` to pin one. When enabled, every response's `X-Signature` is verified over the raw body and a mismatch/missing signature throws the new `StreamsSignatureError`.

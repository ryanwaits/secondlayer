---
"@secondlayer/sdk": minor
---

Streams `verify` now survives a signing-key rotation. The client caches the key id alongside the public key and compares it against the `X-Signature-KeyId` response header; when the server rotates, a fetched key is refreshed once and re-verified, while a pinned key fails closed on a mismatch. Previously the public key was cached for the client's lifetime, so verification broke until the process restarted.

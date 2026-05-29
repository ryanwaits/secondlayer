---
"@secondlayer/api": minor
---

Streams responses are now signed with ed25519 when `STREAMS_SIGNING_PRIVATE_KEY` is set: every read response carries `X-Signature` (over the exact body) + `X-Signature-KeyId`, and the public key is published at `GET /public/streams/signing-key`. Signing is off (no headers) when the key is unset, so it ships safely before provisioning.

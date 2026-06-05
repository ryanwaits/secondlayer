---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
"@secondlayer/subgraphs": patch
---

Sign every subscription webhook with a universal ed25519 signature, regardless of body format. Previously only the `standard-webhooks` format carried an HMAC; `raw`, `cloudevents`, `trigger`, `cloudflare`, and `inngest` deliveries carried no Secondlayer proof, so a receiver had no way to verify a payload came from us. Each delivery now also gets `webhook-id` + `X-Secondlayer-Signature` (ed25519 over `${webhook-id}.${body}`) + `X-Secondlayer-Signature-KeyId`, signed with a single platform key (`SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY`, falling back to the existing `STREAMS_SIGNING_PRIVATE_KEY`). Body shapes stay format-specific. Receivers verify with the new `verifySecondlayerSignature(rawBody, headers, publicKeyPem)` SDK helper against the published public key — no per-subscription secret. Signing is a no-op when no key is configured, so it is safe to ship before the key is provisioned. Also publishes `@secondlayer/shared/crypto/ed25519` as an importable subpath.

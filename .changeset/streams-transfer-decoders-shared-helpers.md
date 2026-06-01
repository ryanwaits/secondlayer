---
"@secondlayer/sdk": patch
---

Streams ft/nft transfer decoders reuse the shared `_payload` helpers instead of inlining their own copies; decoded output and error messages are unchanged.

---
"@secondlayer/api": patch
---

Drop the legacy `from_block` alias from Streams retention checks. It was half-honored (retention read it, but `/v1/streams/events` rejects it as an unknown param), producing a confusing 403-vs-400 split depending on the requested height. Seek positions now come only from `from_height`/`cursor`.

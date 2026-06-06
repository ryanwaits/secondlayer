---
"@secondlayer/api": patch
---

Make the Index `/v1/index/mempool` cursor opaque — a base64url envelope over the insertion sequence — instead of a bare integer, so it can't be mistaken for the `<block_height>:<event_index>` block-position cursors the confirmed endpoints use. The legacy plain-integer cursor is still accepted (in-flight pagers keep working); discovery now documents the per-endpoint cursor shape.

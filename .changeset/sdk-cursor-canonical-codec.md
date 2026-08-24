---
"@secondlayer/sdk": patch
---

Point `Cursor.parse` / `Cursor.atHeight` at the canonical Streams cursor codec.

The SDK helper now rejects the same non-canonical spellings the server 400s
(`"951475:"`, leading zeros, `"1e2:0"`) instead of treating them as real
positions. Rewind still returns `{ blockHeight, eventIndex }` and still throws
`ValidationError`.

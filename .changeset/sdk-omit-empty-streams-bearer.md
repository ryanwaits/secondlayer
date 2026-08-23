---
"@secondlayer/sdk": patch
---

Omit `Authorization` on keyless Streams calls instead of sending `Bearer `.

`new SecondLayer()` with no credential now matches Index: no placeholder
header. An empty Bearer is worse than none.

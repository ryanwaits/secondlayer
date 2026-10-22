---
"@secondlayer/stacks": patch
---

`toStreamsParams()` called without `extra` now returns the plain Streams params shape. The default was `Record<string, never>`, which intersected an index signature onto the result, so a literal of the same shape (or a `toEqual` against it under `@types/bun` 1.4.3) failed to type-check.

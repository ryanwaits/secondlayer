---
"@secondlayer/shared": patch
---

Exports `DEFAULT_MIN_FREE_BYTES` from the archive disk guard so callers can derive a tighter, size-aware free-space requirement and fall back to the same fixed default this module already used.

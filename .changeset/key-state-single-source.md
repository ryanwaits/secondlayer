---
"@secondlayer/shared": minor
"@secondlayer/api": patch
"@secondlayer/worker": patch
---

API key states, liveness and revocation move to `@secondlayer/shared/db/queries/api-keys`. Unused-key insights no longer count expired keys, and a key revoked twice at once is revoked once.

---
"@secondlayer/shared": patch
---

Fix `getOrCreatePool` TLS-skip heuristic: any dotless hostname (Docker service alias like `postgres`, `sl-pg-<slug>`) is now treated as local and skips TLS. Previously only `@postgres:` was whitelisted, causing tenant-DB connections to `sl-pg-<slug>` to try TLS against a non-TLS alpine postgres → ECONNRESET.

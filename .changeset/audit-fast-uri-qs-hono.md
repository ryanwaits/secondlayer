---
"@secondlayer/mcp": patch
"@secondlayer/sdk": patch
---

Security override bumps to clear HIGH-severity `bun audit` findings: `fast-uri` 3.1.5 → 3.1.7 (host confusion / SSRF, GHSA-5jgf-p345-68v8 and siblings), plus in-range moderate pins `qs` 6.15.2 → 6.16.0 and `@hono/node-server` 1.19.13 → 1.19.17. No source changes.

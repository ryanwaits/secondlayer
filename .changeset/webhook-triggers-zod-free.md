---
"@secondlayer/shared": minor
"@secondlayer/sdk": patch
---

Chain trigger types and per-type fields move to a zod-free `@secondlayer/shared/schemas/chain-triggers` subpath, so `@secondlayer/sdk/webhooks/triggers` no longer pulls zod into browser bundles.

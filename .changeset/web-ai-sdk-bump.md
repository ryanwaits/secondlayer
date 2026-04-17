---
"@secondlayer/web": patch
---

Align `ai`/`@ai-sdk/anthropic` versions with workflows v2 (`ai@6.0.167`, `@ai-sdk/anthropic@3.0.71`). Root `overrides` entry in the monorepo `package.json` forces a single version across workspaces to avoid duplicated `@ai-sdk/provider-utils` copies.

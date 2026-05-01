---
"@secondlayer/cli": patch
---

Run scaffold dependency installation through Node-compatible process spawning so published CLI builds can invoke `bun install` without relying on the `Bun` global.

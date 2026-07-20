---
"@secondlayer/cli": patch
"@secondlayer/mcp": patch
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Security dependency bumps to clear HIGH-severity `bun audit` findings: `esbuild` (cli, arbitrary file read), `kysely` pin (JSON-path injection), `@modelcontextprotocol/sdk` (mcp, transitive fast-uri/path-to-regexp/qs/ip-address/@hono-node-server fixes). Root `overrides` added for `picomatch`, `fast-uri`, `path-to-regexp`, `ws`, `qs`, `@hono/node-server`, `ip-address`, `postcss`, `js-yaml` to pin fixed versions where no direct-dep bump reaches them. No source changes.

---
"@secondlayer/scaffold": minor
"@secondlayer/mcp": minor
"@secondlayer/cli": patch
---

Add `generate_contract_interface` — generate a typed TypeScript contract client (typed methods + map/var/constant readers) from a deployed contract's ABI (fetched from the registry). The interface generator and its shared Clarity codegen utils (clarity-conversion, type-mapping, generator-helpers) now live in `@secondlayer/scaffold` and are consumed by both the CLI (`sl generate`, via re-export shims — no behavior change) and the new MCP tool, single-sourcing the logic.

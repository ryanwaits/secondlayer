---
"@secondlayer/scaffold": patch
"@secondlayer/mcp": patch
---

Scaffolded handlers now read fields that exist on the payload. `generateSubgraphCode` emitted `event.<argName>`, which does not exist on any payload — every generated column silently inserted `undefined`. Contract-call handlers now read positional `event.args[i]` (typed `event.input.*` lands with ABI-carrying sources); print handlers read `event.data.<camelName>`. The MCP `scaffold_from_contract` tool also no longer treats `abi.maps` (define-map storage) as print-event topics — sources pinned to map names matched zero events forever. Scaffold emit paths are now regression-gated by a test that type-checks the generated source with tsc.

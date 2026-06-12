---
"@secondlayer/subgraphs": minor
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
"@secondlayer/scaffold": minor
"@secondlayer/cli": minor
"@secondlayer/mcp": minor
---

empirical print-event schema inference: GET /v1/index/contracts/:id/print-schema derives per-topic payload schemas (exact Clarity types from raw_value, presence rates) from indexed history; `sl subgraphs create --from-contract` scaffolds typed defs with prints maps + nullability comments (--table-per-topic for normalized layout); `sl subgraphs codegen --payloads` emits per-topic .d.ts; deploys warn on handler fields never observed for a source's topics; SDK index.printSchema + MCP index_print_schema; prints accepted by filter validation

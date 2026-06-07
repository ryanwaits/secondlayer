---
"@secondlayer/scaffold": minor
"@secondlayer/mcp": minor
"@secondlayer/cli": patch
---

Add `scaffold_from_trait` — generate a deploy-ready subgraph that indexes every contract conforming to a SIP trait (sip-009 → nft_transfer source, sip-010/sip-013 → ft_transfer), no specific contract needed. The trait-scoped generator now lives in `@secondlayer/scaffold` as `generateTraitSubgraph`, single-sourced so the CLI `sl subgraphs scaffold --trait` and the MCP `scaffold_from_trait` tool emit identical output.

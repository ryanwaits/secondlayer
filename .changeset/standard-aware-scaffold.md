---
"@secondlayer/cli": minor
---

`sl subgraphs scaffold` is now standard-aware and emits deploy-ready subgraphs with real handlers (no `// TODO` stubs). It classifies the contract ABI and scaffolds the useful source: a SIP-010 token → an `ft_transfer` source over its asset, SIP-009 → `nft_transfer`, anything else → a single generic `calls` table. New `--functions a,b` scaffolds typed `contract_call` tables for specific functions, and `--trait sip-009|sip-010|sip-013` scaffolds a trait-scoped source that indexes every conforming contract (no contract address needed).

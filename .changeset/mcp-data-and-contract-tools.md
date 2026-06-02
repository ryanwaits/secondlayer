---
"@secondlayer/mcp": minor
---

Add read tools for the core data products so an MCP agent can reach them directly: `datasets_list`/`datasets_query` (Foundation Datasets), `index_ft_transfers`/`index_nft_transfers`/`index_events`/`index_contract_calls` (decoded Index layer, mirroring the SDK surface), `streams_tip`/`streams_events` (Streams firehose, with an API-key hint on keyless auth failures), and `contracts_find` (trait-based contract discovery).

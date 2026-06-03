---
"@secondlayer/subgraphs": patch
---

Normalize the `contract_call` handler payload's spread event `value` to the decoded canonical (from `raw_value`) — completing source-independent parity for contract_call sources whose matched tx carries print/nft events (the node's serde-tagged `value` is not reproducible from the Index API). Also default stx_transfer `memo` to `""` to match the DB tap. Verified byte-identical across all source types via the golden-diff over real prod blocks.

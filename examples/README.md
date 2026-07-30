# Examples

Runnable examples for building on Secondlayer. Most are indexing — the question is how much of the indexer you run. One goes a step further and proves the **Bitcoin** behind the data on-chain.

| Example | Service | What it builds |
| --- | --- | --- |
| [`sales-index`](./sales-index) | [Index](https://secondlayer.tools/index-api) | An app index on **decoded** rows — every Gamma marketplace sale in your own Postgres, ~50 lines, with `consume()` checkpointing and reorg rollback. Includes the one-file Subgraph it graduates to. |
| [`reorg-demo`](./reorg-demo) | [Index](https://secondlayer.tools/index-api) | **Why the loop needs `onReorg`** — the same feed written to two tables by the same handler, one with rollback and one without, against a scripted chain that forks. The real SDK consumer, pointed at a fake chain. Runs in seconds. |
| [`indexer-from-zero`](./indexer-from-zero) | [Streams](https://secondlayer.tools/streams) | An indexer from the **raw** inputs — signed parquet dumps for cold history, then a checkpointed live tail. Plus a `sl streams pull` + DuckDB one-liner. |
| [`sbtc-l1-proof`](./sbtc-l1-proof) | [Index](https://secondlayer.tools/index-api) + [`@secondlayer/stacks`](../packages/stacks) | From indexed data to **on-chain Bitcoin proof** — for every sBTC deposit the index surfaces (with its `bitcoin_txid`), build the Bitcoin SPV proof and run the SIP-044 native built-ins against the `spv-adapter` contract. Runs in Clarinet simnet; the same calls now also run against the live mainnet adapter post-Epoch-4.0. |

Want zero ops instead of running the loop yourself? Deploy a [Subgraph](https://secondlayer.tools/subgraphs) — one TypeScript file, hosted tables, public REST API.

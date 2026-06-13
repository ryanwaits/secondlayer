# Examples

Runnable examples for building on Secondlayer. Everything here is indexing — the question is how much of the indexer you run.

| Example | Service | What it builds |
| --- | --- | --- |
| [`sales-index`](./sales-index) | [Index](https://secondlayer.tools/index-api) | An app index on **decoded** rows — every Gamma marketplace sale in your own Postgres, ~50 lines, with `consume()` checkpointing and reorg rollback. Includes the one-file Subgraph it graduates to. |
| [`indexer-from-zero`](./indexer-from-zero) | [Streams](https://secondlayer.tools/streams) | An indexer from the **raw** inputs — signed parquet dumps for cold history, then a checkpointed live tail. Plus a `sl streams pull` + DuckDB one-liner. |

Want zero ops instead of running the loop yourself? Deploy a [Subgraph](https://secondlayer.tools/subgraphs) — one TypeScript file, hosted tables, public REST API.

---
"@secondlayer/subgraphs": minor
"@secondlayer/shared": minor
"@secondlayer/cli": minor
"@secondlayer/api": minor
---

Add bring-your-own-database support to subgraphs. Deploy with `sl subgraphs deploy <file> --database-url <postgres-url>` to write a subgraph's schema, handler rows, and serving reads to your own Postgres while the managed pipeline still ingests, decodes, matches, and runs your handler. The connection string is stored encrypted at rest and never returned. Handler writes must be idempotent (insert/upsert); reindex is unavailable on BYO subgraphs (re-deploy to rebuild), and deleting a BYO subgraph never drops the schema in your database.

---
"@secondlayer/subgraphs": patch
---

Subgraphs reading Postgres directly now give events the same `event_index` and id as the Index API, including history below block 7,440,500 where raw numbering restarts in each transaction. Self-hosters: event ids change only for events below about block 7.44M, and only when a range is reprocessed. A reindex rebuilds the schema, so nothing duplicates.

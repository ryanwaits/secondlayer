# sales-index

A complete app index on [Secondlayer Index](https://secondlayer.tools/index-api): every sale on Gamma's marketplace, in your own Postgres — one file. We run the chain indexer and the decoder; this loop is yours, and the hard parts belong to the sink.

```bash
bun install
DATABASE_URL=postgres://… bun run indexer.ts
```

What it demonstrates:

- **Backfill from genesis** — `fromHeight: 0` on the first run sweeps all history this instance has (decoded `purchase-asset` calls, server-side filtered).
- **Crash-safe resume, by construction** — `kyselySink` commits rows AND the cursor in one transaction and resumes from its own checkpoint. A crash mid-batch aborts both, so the batch is simply re-read. Kill it anywhere; there is no checkpoint code to get wrong.
- **Automatic reorg handling, zero user code** — the sink deletes rows from the fork block up (inclusive) and commits the rewound cursor atomically; the consumer re-reads the canonical run. No `onReorg` handler exists in this file. Inserts are idempotent (`ON CONFLICT DO NOTHING`), so at-least-once delivery never double-counts.
- **Live tail** — after backfill the same loop holds the tip, polling with backoff.

Prefer the instance to run the loop? This exact table is one `defineSubgraph()` file — see [`subgraph.ts`](./subgraph.ts).

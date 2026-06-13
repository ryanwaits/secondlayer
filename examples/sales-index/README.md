# sales-index

A complete app index on [Secondlayer Index](https://secondlayer.tools/index-api): every sale on Gamma's marketplace, in your own Postgres, ~50 lines. We run the chain indexer and the decoder; this loop is yours.

```bash
bun install
DATABASE_URL=postgres://… bun run indexer.ts
```

What it demonstrates:

- **Backfill from genesis** — `fromHeight: 0` on the first run sweeps all history (decoded `purchase-asset` calls, server-side filtered).
- **Crash-safe resume** — rows and the cursor commit in one transaction; `consume()` restarts from `loadCheckpoint()`. Kill it anywhere.
- **Automatic reorg handling** — `onReorg` drops rows above the fork point; the consumer rewinds and re-reads the canonical run. Inserts are idempotent (`ON CONFLICT DO NOTHING`), so at-least-once delivery never double-counts.
- **Live tail** — after backfill the same loop holds the tip, polling with backoff.

Prefer zero ops? This exact table is one `defineSubgraph()` file — see [`subgraph.ts`](./subgraph.ts) — and Secondlayer runs the loop instead: hosted Postgres, public REST API, backfill and reorg handling included.

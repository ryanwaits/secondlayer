# sales-index

A complete app index on [Secondlayer Index](https://secondlayer.tools/index-api): every sale on Gamma's marketplace, in your own Postgres, ~50 lines. We run the chain indexer and the decoder; this loop is yours.

```bash
bun install
DATABASE_URL=postgres://… bun run indexer.ts
```

What it demonstrates:

- **Backfill from genesis** — `fromHeight: 0` on the first run sweeps all history (decoded `purchase-asset` calls, server-side filtered). On the hosted API this needs a paid plan or pay-as-you-go credits; free/keyless reads cover the last 24h (an uncredited free run returns `402` below that). Self-hosted is unbounded.
- **Crash-safe resume** — rows and the cursor commit in one transaction; `consume()` restarts from `loadCheckpoint()`. Kill it anywhere.
- **Automatic reorg handling** — `onReorg` drops rows from the fork block up (inclusive of `fork_point_height`); the consumer rewinds and re-reads the canonical run from the fork block's first event. Inserts are idempotent (`ON CONFLICT DO NOTHING`), so at-least-once delivery never double-counts.
- **Live tail** — after backfill the same loop holds the tip, polling with backoff.

Prefer zero ops? This exact table is one `defineSubgraph()` file — see [`subgraph.ts`](./subgraph.ts) — and Secondlayer runs the loop instead: hosted Postgres, public REST API, backfill and reorg handling included.

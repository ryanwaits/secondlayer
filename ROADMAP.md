# Roadmap — deferred & flagged work

> Canonical prioritized backlog of work we've consciously deferred, so it isn't lost.
> `STRATEGY.md` holds strategic direction and wins on positioning conflicts; this is the
> tactical TODO that hangs off it. Add items when you defer something; delete when shipped.
> Last updated 2026-06-13 (indexer-positioning arc + the three replay/queue findings).

## P1 — correctness, do next

_none open._

## P2 — should do

- **Dump history back to chain genesis.** Streams parquet dumps cover blocks
  ~7,810,000–8,259,999 only (42 windows; the dump program started 2026-06-03).
  `replay({ from: "genesis" })` now spans all 42 (cumulative `latest.json` shipped),
  but that's "earliest available dump," not chain block 1. To make genesis literal,
  backfill windows 1–7.81M from the source DB (re-export ~780 windows; confirm source
  retains that range first). Until then docs say "earliest available dump."
  Ref: `packages/indexer/src/streams-bulk/exporter.ts`, `rebuild-latest-manifest.ts`.

- **tsc tech debt: `ctx.increment` API drift.** 13 type errors, pre-existing, unrelated
  to recent work: `scripts/seed-balances/{sbtc,alex,usdcx}-balances.ts` and
  `packages/api/test/handler-replay-safety.test.ts` call `ctx.increment(...)` with a
  string where the type now wants `"update" | "patchOrInsert" | "increment"`. Either
  update the callers to the current subgraph ctx API or delete the dead seed scripts.

- **`secondlayer-api` skill is stale.** `SKILL.md` calls Streams "pre-alpha,
  internal-only"; Streams is prod-live with public dumps + an x402 read rail. Agents
  entering via the skill will anti-recommend a shipped product. Out of scope during the
  positioning arc by founder call; fix on next skill touch.

## P3 — nice to have / pending a decision

- **`SUBGRAPH_HEAVY_OP_BUDGET` tuning (env, no deploy).** Heavy (genesis-scale) subgraph
  reindexes are capped at 2 in flight to protect the target plane; fresh genesis deploys
  queue behind in-flight reindexes by design. Raising the budget speeds fresh deploys at
  the cost of target-plane write contention. Left at **2** (founder, 2026-06-13). Revisit
  if fresh-deploy latency becomes a prospect-facing problem.
  Ref: `packages/shared/src/db/queries/subgraph-operations.ts` (claim budget),
  prod env on `secondlayer-subgraph-processor-1`.

- **`sl index sync` scaffold.** One command to emit a mirror schema + walk loop +
  checkpoint table for Index (turns the parts kit into a 1-command start). Deferred
  behind the CLI local-dev freeze; `sl index codegen` already covers the schema half.

## P4 — watch / cleanup

- **`latest.json` size ceiling.** The cumulative dump manifest grows ~1 file entry per
  10k blocks (~250KB at 42 windows). Fine for years; if it crosses ~a few MB, paginate or
  add an index manifest the SDK walks.

- **`gamma-sales` demo subgraph.** Deployed public as the docs graduation example; its
  genesis reindex drains behind the heavy-op budget. Decide whether it stays a permanent
  showcase or gets torn down after the docs ship.

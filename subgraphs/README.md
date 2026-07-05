# Hosted public subgraphs — canonical source

Source of truth for the **hosted, public** subgraphs that power secondlayer's own
surfaces (the sBTC explorer, Explore directory, etc.). This is distinct from:

- `bench/subgraphs/` — throwaway benchmarking subgraphs.
- `examples/` — standalone tutorials a user clones (`sales-index`, `indexer-from-zero`).

**Rule (per `docs/internal/charter/index-vs-subgraphs.md`):** our product pages run on
the subgraphs we sell. Every hosted public subgraph must have its source committed here
and be deployed *from this tree* — never from an out-of-tree local file. Edit here, then
`sl subgraphs deploy subgraphs/<name>.ts`.

## Recovery status

These were all deployed from local files that were never committed (git-orphan gap found
2026-06-20). Recovering each from its deployed source-capture
(`GET /api/subgraphs/<name>/source`):

| Subgraph | Source committed | Deployed `start_block` | Drift vs source |
|---|---|---|---|
| `sbtc-flows` | ✅ `sbtc-flows.ts` | 5,143,314 | source declares `860000` |
| `pox-stacking` | ✅ `pox-stacking.ts` | 5,143,314 | source declares none (genesis) |
| `bns-names` | ✅ `bns-names.ts` | 5,143,314 | source declares none (genesis) |
| `contract-deployments` | ✅ `contract-deployments.ts` | genesis (deployed 2026-07-03) | none |

All three deploy `start_block`s were set by a `--start-block 5143314` override, not the
source. Reconcile (align source ⇄ deployment) on each subgraph's next redeploy.

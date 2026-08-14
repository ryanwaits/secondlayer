# Subgraph templates

Example `defineSubgraph()` sources. Copy onto your instance and deploy. Not a
hosted catalog — Secondlayer does not run these as a public API.

Distinct from:

- `bench/subgraphs/` — throwaway benchmarking subgraphs.
- `examples/` — standalone tutorials a user clones (`sales-index`, `indexer-from-zero`).

| Template | What it indexes |
|---|---|
| `sbtc-flows` | sBTC registry deposits / withdrawals |
| `pox-stacking` | PoX stacking and delegation |
| `bns-names` | BNS-V2 names |
| `contract-deployments` | Every contract deploy |
| `asset-holdings` | Per-holder FT + STX balances |

```bash
secondlayer subgraphs deploy subgraphs/<name>.ts
```

against your local `SL_API_URL`. Leftover hosted deploys of these names are
not a product; do not add more.

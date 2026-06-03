# Subgraph source: Streams clock + Index data (streams-index mode)

By default the subgraph runtime reads chain data straight from the indexer
Postgres (`PostgresBlockSource`). `SUBGRAPH_SOURCE=streams-index` re-points
eligible subgraphs onto the **public microservices** — the Streams clock
(`/v1/streams/reorgs`) + the Index data plane (`/v1/index/blocks`, `/events`,
`/transactions`) — realizing the "tooling builds on the services" model.

`matchSources` / handlers / flush / outbox are unchanged; only the loader, tip,
and reorg signal swap behind the `BlockSource` seam. Reconstruction feeds the
existing pipeline byte-identically (proven by the golden-diff, below).

## Enable

Set on the subgraph-processor service:

```
SUBGRAPH_SOURCE=streams-index
SUBGRAPH_INDEX_API_URL=http://api:3800   # or STREAMS_API_URL; serves both /v1/index + /v1/streams
INDEX_INTERNAL_API_KEY=<enterprise internal key>   # unmetered Index reads
STREAMS_INTERNAL_API_KEY=<enterprise internal key> # Streams /reorgs
```

Eligibility is decided **per subgraph** (`isStreamsIndexEligible`): all sources
must be event-types or `contract_call`/`contract_deploy` filters, with
Record-style sources (no array/`*`-handler). Ineligible subgraphs transparently
stay on the DB tap. Trait-scoped sources ARE eligible — trait resolution reads
the contract registry on the platform DB, which the processor always holds.

`db` is the instant rollback: unset `SUBGRAPH_SOURCE` and restart.

## Cut over safely

1. **Validate parity first** (the gate): run the golden-diff against the target
   API over a representative range. It loads the same range through both sources
   and asserts identical handler payloads:
   ```
   bun run packages/subgraphs/test/golden-diff.ts --from H1 --to H2 --base-url <api>
   # or against a captured DB fixture (capture-fixtures.ts) + the public API:
   bun run packages/subgraphs/test/golden-diff.ts --from H1 --to H2 \
     --fixture packages/subgraphs/test/fixtures/blockdata-H1-H2.json --base-url https://api.secondlayer.tools
   ```
   Any non-zero `diffs` is a blocker.
2. Flip `SUBGRAPH_SOURCE=streams-index` on ONE low-volume processor / subgraph
   first; watch processor lag vs Index `tip.lag_seconds`.
3. Roll out; keep `db` as the rollback.

## Self-host

Supported for **fully self-hosted** deployments only (own api + indexer +
registry + processor): point `SUBGRAPH_INDEX_API_URL`/`STREAMS_API_URL` at your
own API and use your own internal keys. We do not support pointing a
self-hosted processor at the *public* hosted API.

## How it stays byte-identical

The Index API serves flat, decoded rows; `reconstruct.ts` rebuilds the raw
`blocks`/`transactions`/`events` shapes the matcher + runner expect — including
re-suffixing event `type`, the `stx_lock` field remap, and decoding nft/print
values from the canonical hex (`raw_value` / `function_args_hex`) rather than the
node's verbose serde-tagged form. Validated end-to-end by the golden-diff over
real prod blocks.

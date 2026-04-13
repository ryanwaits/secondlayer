---
"@secondlayer/api": minor
"@secondlayer/sdk": minor
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Server-side subgraph bundler + source capture, mirroring the workflows authoring loop.

- **API**: new `POST /api/subgraphs/bundle` runs `bundleSubgraphCode` from `@secondlayer/bundler` and returns `{ name, version, sources, schema, handlerCode, sourceCode, bundleSize }`. `BundleSizeError → 413`, other failures → 400 with `code: "BUNDLE_FAILED"`. New `GET /api/subgraphs/:name/source` returns the original TypeScript source for deployed subgraphs, or a `readOnly` payload for rows predating the migration. `POST /api/subgraphs` now threads `sourceCode` through `deploySchema` so the original source is persisted on deploy.
- **SDK**: new `subgraphs.bundle({ code })` and `subgraphs.getSource(name)` methods + `BundleSubgraphResponse` / `SubgraphSource` types.
- **shared**: migration `0031_subgraph_source_code` adds `source_code TEXT NULL` to the `subgraphs` table; `registerSubgraph` upsert + `DeploySubgraphRequest` schema both accept an optional `sourceCode` field (max 1MB).
- **subgraphs**: `deploySchema()` accepts `sourceCode` in its options and forwards it to `registerSubgraph`.

Unlocks the next wave of the chat authoring loop (read/edit/deploy/tail subgraphs in a session).

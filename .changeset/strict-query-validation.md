---
"@secondlayer/api": minor
"@secondlayer/cli": minor
---

Strict query validation across public surfaces — Datasets, Index, Streams, and Subgraphs REST now reject unknown query params with `400 VALIDATION_ERROR` (with "did you mean…" hint) instead of silently ignoring them. `limit=0` is now rejected; `limit` is still capped at 1000. Subgraph REST filter parser now returns `400` (not `500`) on unknown ops like `?col.bogus=X`, and detects misplaced operators like `?col=gt.X`. Adds optional `sl subgraphs deploy --strict` flag to run `tsc --noEmit` against the handler before deploy.

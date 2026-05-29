---
"@secondlayer/api": minor
---

`GET /v1/streams/tip` now returns `finalized_height` — the highest Stacks block past the burn-confirmation finality boundary, computed from the tip's `burn_block_height`. Lets consumers tell which blocks are immutable.

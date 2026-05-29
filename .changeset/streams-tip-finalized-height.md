---
"@secondlayer/api": minor
---

Streams responses now carry finality info: `GET /v1/streams/tip` returns `finalized_height` (the highest Stacks block past the burn-confirmation boundary, derived from the tip's `burn_block_height`), and every event in `/events`, `/events/:tx_id`, and `/blocks/:height/events` carries a `finalized` flag. Lets consumers tell which data is immutable.

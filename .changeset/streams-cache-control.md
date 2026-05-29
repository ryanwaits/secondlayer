---
"@secondlayer/api": minor
---

Streams read endpoints now set finality-gated `Cache-Control`. Pages whose range is fully past the finality boundary (closed `to_height ≤ finalized_height`, a finalized single block/tx) are served `public, max-age=31536000, immutable`; tip-spanning and default requests stay `private, max-age=2` so a shared cache never serves stale tip data.

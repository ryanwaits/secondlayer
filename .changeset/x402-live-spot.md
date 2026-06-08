---
"@secondlayer/api": patch
---

x402 pricing now uses a live, cached USD spot feed for the non-stable assets (sBTC→BTC/USD, STX→STX/USD) instead of a static env value. `spotUsd` is stale-while-revalidate and never blocks a request: it serves an in-process cache (refreshed ~60s in the background, last-known held up to 10m if the feed is down). Fallback chain: live cache → `X402_SPOT_<SYM>_USD` env override → omit the asset — so if a price is unavailable the challenge degrades to USDCx-only (the dollar peg, always exact) rather than mispricing. Feed URL overridable via `X402_SPOT_URL` (CoinGecko shape).

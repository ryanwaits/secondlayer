---
"@secondlayer/api": patch
---

fix: x402 spot feed used `??` for `X402_SPOT_URL`, but compose injects it as an empty string when unset — so prod was calling `fetch("")` ("URL must not be a blank string") and silently falling back to the env STX price forever. Resolve the feed URL with `||` (and at call-time) so an empty env falls back to the CoinGecko default. STX/sBTC now actually price off the live feed.

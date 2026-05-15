---
"@secondlayer/api": patch
---

Allow anonymous reads on `/v1/index/ft-transfers` and `/v1/index/nft-transfers`. Bearer middleware now passes through when no `Authorization` header is present; keyed flow (tier validation, metering, rate limiting) still runs for requests that send a token.

---
"@secondlayer/api": patch
---

The `/v1/index/pox5/events` `signer` and `signer_manager` param docs no longer tell you to filter both — `signer` now covers a pool's claims and key grants too, the same principal the contract prints as `signer_manager`.

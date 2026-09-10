---
"@secondlayer/sdk": minor
---

Split instance `apiKey` (`INSTANCE_TOKEN`) from `accountKey`
(`SECONDLAYER_API_KEY`). Archive quote/fetch no longer send the instance token.
`SL_API_KEY` is no longer an alias of `INSTANCE_TOKEN`.

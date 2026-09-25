---
"@secondlayer/sdk": major
---

`SL_API_URL`, `SL_API_KEY`, and `SL_ARCHIVE_API_KEY` are no longer read. `resolveBaseUrl` reads only `SECONDLAYER_API_URL` (falling back to the local one-box default); `resolveAccountKey` reads only `SECONDLAYER_API_KEY`. Set the canonical names — the old ones are now silently ignored, with no warning and no fallback.

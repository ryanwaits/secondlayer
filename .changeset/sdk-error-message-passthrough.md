---
"@secondlayer/sdk": patch
---

An error body's own `message` field now wins over its `error` code (e.g. `spend_cap_reached`), so `ApiError.message` shows the human text instead of the raw code.

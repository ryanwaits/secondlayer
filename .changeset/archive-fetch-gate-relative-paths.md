---
"@secondlayer/api": patch
---

`POST /api/archive/quote` and `POST /api/archive/fetch` now accept manifest-relative partition paths (`<dataset>/<from>-<to>-<hash16>.parquet`) in addition to full R2 object keys. The CLI never learns the archive's R2 key prefix; the server resolves a relative path to the full key at presign time.

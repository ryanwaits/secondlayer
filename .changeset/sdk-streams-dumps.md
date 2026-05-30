---
"@secondlayer/sdk": minor
---

`createStreamsClient` gains a `dumps` namespace (set `dumpsBaseUrl` to the public bulk bucket): `dumps.list()` fetches the parquet manifest, `dumps.fileUrl(file)` resolves a file's URL, and `dumps.download(file)` fetches a parquet and verifies its sha256 against the manifest. Backs "download all the raw data" bulk backfill.

---
"@secondlayer/indexer": patch
---

Publisher now refreshes `latest.json` on every tick — even when the latest finalized range's parquet already exists in R2. Previously `latest.json` only updated when a new parquet was written, so it drifted behind reality for families with no new data (showed an older range despite recent parquets being live in R2). New `manifestOnly` mode in `exportDatasetRange` re-derives the manifest locally and uploads only the JSON; the byte-identical existing parquet stays in place.

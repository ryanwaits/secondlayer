---
"@secondlayer/cli": minor
---

Add `sl streams pull --to <dir>`: downloads finalized bulk parquet dumps to a local directory and verifies each file's sha256 against the manifest. Dumps are public, so no API key is needed — pass `--dumps-url` or set `SL_STREAMS_DUMPS_URL`. Supports `--from-block`/`--to-block` range filtering.

---
"@secondlayer/cli": major
---

Config now stores only `network`, and `config set` rejects other keys. Remove `SL_API_PORT`, `SL_INDEXER_PORT`, `SL_DATA_DIR` and the `SL_PLATFORM_API_URL` alias, the `whoami` project field, and `chainIdValid` from `doctor --json`.

---
"@secondlayer/cli": major
---

`SL_API_URL`, `SL_API_KEY`, and `SL_ARCHIVE_API_KEY` are no longer read or written. Set `SECONDLAYER_API_URL` / `SECONDLAYER_API_KEY` instead. `secondlayer init` now honors `SECONDLAYER_API_URL` (it previously read only the legacy name, so a user who set the canonical var was silently ignored). `secondlayer backup` now includes `SECONDLAYER_API_KEY` in its secrets bundle instead of `SL_API_KEY`, so a backup no longer misses the real hosted key. `secondlayer init` / `setup` write only the canonical names into the generated `.env`.

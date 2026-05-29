---
"@secondlayer/cli": minor
---

Unify CLI authentication and fix a silent prod-routing bug. The endpoint and credential now resolve independently, so `SL_API_URL=http://localhost…` redirects the endpoint while keeping your session token instead of silently hitting production (previously `resolveAuth` required both URL and key while `isOssMode` keyed off URL-only, so they disagreed). One credential precedence chain — `--api-key` flag > `SL_API_KEY` > stored session — applies to every command, including `streams`; `SL_SERVICE_KEY` and `SL_STREAMS_API_KEY` are accepted as legacy aliases. Adds global `--api-key`/`--api-url` flags (inherited by all commands) and `sl login --with-token` for headless/CI setup (`echo "$SL_API_KEY" | sl login --with-token`). `sl whoami` now reports the effective API URL and credential source and exits non-zero when unauthenticated (previously exited 0, which could mask `sl whoami && …` checks).

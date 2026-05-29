---
"@secondlayer/cli": major
---

Subscription commands now authenticate through the same `resolveAuth()` path as every other command (`SL_API_KEY` → stored session, with the global `--api-key` / `--api-url` flags). The bespoke per-command `--service-key` and `--base-url` flags are removed — use `--api-key` / `--api-url` (or `SL_API_KEY` / `SL_API_URL`) instead. This also retires the last code path that still read the deprecated `SL_SERVICE_KEY`, completing the move to a single `SL_API_KEY` credential across the CLI.

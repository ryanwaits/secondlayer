---
"@secondlayer/shared": minor
---

`IndexHttpClient.getIndexTip()`/`getIndexSourceTip()` take an optional `{ wait, knownHeight }` to long-poll the Index tip instead of returning immediately (plan-063). Against a server that rejects the long-poll params, the client falls back to a plain request automatically and remembers not to try again, exposed via the new `waitIsSupported()`. Also new: `IndexHttpStatusError` (carries the HTTP status), `MAX_INDEX_WAIT_SECONDS`, and `createWakeBus` in `@secondlayer/shared/queue/listener` — a shareable "wait for the next NOTIFY" helper with a plain-timer fallback baked into every caller.

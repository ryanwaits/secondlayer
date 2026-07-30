---
"@secondlayer/sdk": minor
---

One error family, and consume loops that survive transient failures:

- New `SecondLayerError` root with `shortMessage`, `code`, `docsUrl`, `metaMessages`, `retryable`, `retryAfterSeconds`, and `walk(predicate)` for cause-chain inspection. `ApiError` extends it; `AuthError`, `RateLimitError`, and `ValidationError` keep their class identity but are re-parented under `ApiError` — so `catch (e) { if (e instanceof RateLimitError) … }` now matches around Index and platform calls too, not just Streams. `Retry-After` is preserved as `retryAfterSeconds` instead of being stringified into prose.
- Both consume loops (`index.*.consume`, `streams.events.consume`) now retry the page fetch on 429/5xx/network failures — a single transient error no longer kills an hours-long backfill. Configure with `retryCount`/`retryDelay` (same vocabulary as `@secondlayer/stacks` transports); a server `Retry-After` overrides the backoff. Retry wraps ONLY the fetch: `onBatch`/`onReorg` throws and 4xx responses always propagate. An optional `onError` observer fires before each retry sleep.
- Operational errors carry a docs pointer (`docsUrl`, appended to the message), and `ByoBreakingChangeError` surfaces its DROP + rebuild DDL on `metaMessages` so a bare `console.error` shows the operator what to run.
